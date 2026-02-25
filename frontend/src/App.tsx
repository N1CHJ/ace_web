import { useState, useEffect, useRef, type ChangeEvent } from 'react';
import './App.css';

const WORKER_URL = "https://ace-worker.ace-gateway.workers.dev/api";
const ADMIN_PASSWORD = "jane";

interface Rep {
  Rep: number;
  Score: number;
  Matched_Ideal?: string;
}

interface StatsObj {
  reps: Rep[];
}

interface VideoUrls {
  uploaded?: string;
  overlay?: string;
  ideal?: string;
}

interface ReplicateOutput {
  stats?: string; // JSON string of StatsObj
}

interface StatusResponse {
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output?: ReplicateOutput;
}

interface FeedbackResponse {
  status: 'pending' | 'succeeded';
  urls?: VideoUrls;
  advice?: string;
}

interface Session {
  id: string;
  exercise: string;
  score: number;
  advice: string;
  video_url: string;
  overlay_url: string;
  ideal_url: string;
  created_at: string;
}

interface DemoResponse {
  found: boolean;
  data: {
    stats?: StatsObj;
    urls?: VideoUrls;
    advice?: string;
  };
  triggering?: boolean;
  id?: string;
}

function App() {
  const [task, setTask] = useState<'analyze' | 'ingest_reference'>('analyze');
  const [sports, setSports] = useState<string[]>([]);
  const [selectedSport, setSelectedSport] = useState<string>('');
  const [customSportName, setCustomSportName] = useState<string>('');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [makeOverlay, setMakeOverlay] = useState<boolean>(false);
  const [status, setStatus] = useState<string>('');
  const [videoUrls, setVideoUrls] = useState<VideoUrls | null>(null);
  const [advice, setAdvice] = useState<string>('');
  const [stats, setStats] = useState<StatsObj | null>(null);
  const [isLoadingSports, setIsLoadingSports] = useState<boolean>(true);
  const [dashboardHistory, setDashboardHistory] = useState<Session[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadSports();
    fetchDashboard();
  }, []);

  const fetchDashboard = async () => {
    try {
      const res = await fetch(`${WORKER_URL}/dashboard`);
      if (res.ok) {
        const data = await res.json();
        setDashboardHistory(data);
      }
    } catch (e) {
      console.error("Dashboard fetch error:", e);
    }
  };

  const loadSports = async () => {
    setIsLoadingSports(true);
    try {
      const res = await fetch(`${WORKER_URL}/config`);
      if (!res.ok) throw new Error("Failed to load sports");
      const config = await res.json();
      setSports(Object.keys(config));
      if (Object.keys(config).length > 0) {
        setSelectedSport(Object.keys(config)[0]);
      }
    } catch (e) {
      console.error(e);
      setSports(['Back Squat']);
      setSelectedSport('Back Squat');
    } finally {
      setIsLoadingSports(false);
    }
  };

  const toTitleCase = (str: string) => {
    return str.replace(/\w\S*/g, (text) => text.charAt(0).toUpperCase() + text.substring(1).toLowerCase());
  };

  const resetUI = () => {
    setVideoUrls(null);
    setStats(null);
    setAdvice('');
    setStatus('');
  };

  const runDemo = async () => {
    resetUI();
    setAdvice("Initializing Demo...");
    setMakeOverlay(true);
    setStatus("Checking for demo data...");

    try {
      const res = await fetch(`${WORKER_URL}/demo`);
      const result: DemoResponse = await res.json();

      if (result.found) {
        setStatus("✅ Demo Loaded from Cache");
        if (result.data.stats) setStats(result.data.stats);
        if (result.data.urls) setVideoUrls(result.data.urls);
        if (result.data.advice) setAdvice(result.data.advice);
      } else if (result.triggering && result.id) {
        setStatus("⚙️ Demo data missing. Generating fresh analysis (approx 30s)...");
        pollStatus(result.id);
      }
    } catch (e: any) {
      setStatus("Error: " + e.message);
    }
  };

  const startProcessing = async () => {
    let exerciseName = selectedSport;
    if (exerciseName === "NEW_SPORT_ENTRY") {
      const rawName = customSportName.trim();
      if (!rawName) return alert("Enter a name.");
      exerciseName = toTitleCase(rawName);
    }

    if (task === 'ingest_reference') {
      if (prompt("🔒 Password:") !== ADMIN_PASSWORD) return alert("Incorrect Password.");
    }

    if (!videoFile) return alert("Select a video!");

    resetUI();
    setAdvice("Waiting for ACE...");
    setStatus("Starting upload...");

    try {
      const uploadResponse = await fetch(`${WORKER_URL}/upload?sport=${encodeURIComponent(exerciseName)}&task=${task}`, {
        method: "PUT",
        headers: {
          "Content-Type": videoFile.type,
          "X-File-Name": videoFile.name
        },
        body: videoFile
      });

      if (!uploadResponse.ok) throw new Error("Upload failed");
      const { key: videoKey } = await uploadResponse.json();

      setStatus("Queuing Analysis Job...");
      const predictResponse = await fetch(`${WORKER_URL}/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoKey,
          task,
          exerciseName,
          makeOverlay,
          is_demo: false
        })
      });

      const { id } = await predictResponse.json();
      pollStatus(id);

      if (selectedSport === "NEW_SPORT_ENTRY") {
        setTimeout(loadSports, 2000);
      }
    } catch (e: any) {
      console.error(e);
      setStatus(`Error: ${e.message}`);
    }
  };

  const pollStatus = async (id: string) => {
    while (true) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        const res = await fetch(`${WORKER_URL}/status?id=${id}&_t=${Date.now()}`);
        const data: StatusResponse = await res.json();
        setStatus(`Status: ${data.status}`);

        if (data.status === 'succeeded') {
          if (data.output?.stats) {
            try {
              const statsObj: StatsObj = JSON.parse(data.output.stats);
              if (task === 'ingest_reference') {
                setStatus("✅ Ingest Complete!");
              } else {
                setStats(statsObj);
                setAdvice("<em>🤖 ACE is analyzing results...</em>");
                pollFeedback(id);
              }
            } catch (err) {
              console.error("Failed to parse stats:", err);
            }
          }
          break;
        } else if (data.status === 'failed' || data.status === 'canceled') {
          setStatus("Analysis Failed");
          break;
        }
      } catch (e) {
        console.log("Polling error:", e);
      }
    }
  };

  const pollFeedback = async (id: string) => {
    let attempts = 0;
    while (attempts < 30) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        const res = await fetch(`${WORKER_URL}/feedback?id=${id}&_t=${Date.now()}`);
        if (res.ok) {
          const data: FeedbackResponse = await res.json();
          if (data.status === "succeeded") {
            if (data.urls) setVideoUrls(data.urls);
            if (data.advice) setAdvice(data.advice);
            return;
          }
        }
      } catch (e) {
        console.error("Feedback polling error:", e);
      }
      attempts++;
    }
    setAdvice("<em>(Coach timed out. Check console for errors.)</em>");
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setVideoFile(e.target.files[0]);
    }
  };

  const formatAdvice = (text: string) => {
    return text.replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  };

  return (
    <div className="App">
      <h1>🏋️ ACE Coach</h1>

      <button onClick={runDemo} className="btn-demo">▶ Run Demo</button>

      <div className="tabs">
        <div
          className={`tab ${task === 'analyze' ? 'active' : ''}`}
          onClick={() => setTask('analyze')}
        >
          Analyze Form
        </div>
        <div
          className={`tab ${task === 'ingest_reference' ? 'active' : ''}`}
          onClick={() => setTask('ingest_reference')}
        >
          Admin Ingest
        </div>
      </div>

      <div className="container">
        <select
          value={selectedSport}
          onChange={(e) => setSelectedSport(e.target.value)}
          disabled={isLoadingSports}
        >
          {isLoadingSports ? (
            <option>Loading sports...</option>
          ) : (
            <>
              {sports.map((sport) => (
                <option key={sport} value={sport}>{sport}</option>
              ))}
              <option disabled>──────────</option>
              <option value="NEW_SPORT_ENTRY">➕ Create New Sport...</option>
            </>
          )}
        </select>

        {selectedSport === "NEW_SPORT_ENTRY" && (
          <div id="customInputContainer">
            <input
              type="text"
              placeholder="Type new sport name (e.g. Cricket Bowl)"
              value={customSportName}
              onChange={(e) => setCustomSportName(e.target.value)}
              autoFocus
            />
          </div>
        )}

        <div className="options-row">
          <input
            type="file"
            accept="video/*"
            onChange={handleFileChange}
            ref={fileInputRef}
          />

          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={makeOverlay}
              onChange={(e) => setMakeOverlay(e.target.checked)}
            />
            Generate Overlay?
          </label>
        </div>

        <button onClick={startProcessing}>Run Processing</button>
      </div>

      <div className="status">{status}</div>

      {videoUrls && (
        <div className="video-grid">
          {videoUrls.uploaded && (
            <div className="video-card">
              <h4>Your Video</h4>
              <video src={videoUrls.uploaded} controls playsInline loop />
            </div>
          )}
          {videoUrls.overlay && (
            <div className="video-card">
              <h4>AI Overlay</h4>
              <video src={videoUrls.overlay} controls playsInline loop />
            </div>
          )}
          {videoUrls.ideal && (
            <div className="video-card">
              <h4>Pro Reference</h4>
              <video src={videoUrls.ideal} controls playsInline loop />
            </div>
          )}
        </div>
      )}

      {advice && (
        <div className="feedback-container">
          <h3>🤖 Coach's Feedback</h3>
          <div
            dangerouslySetInnerHTML={{ __html: formatAdvice(advice) }}
          />
          <small>Generated via ACE</small>
        </div>
      )}

      {stats && (
        <div id="stats-output">
          <h3>Rep-by-Rep Scores</h3>
          <table>
            <thead>
              <tr>
                <th>Rep</th>
                <th>Score</th>
                <th>Match</th>
              </tr>
            </thead>
            <tbody>
              {stats.reps.map((rep, idx) => (
                <tr key={idx}>
                  <td>{rep.Rep}</td>
                  <td className={rep.Score >= 80 ? 'score-good' : 'score-bad'}>
                    {rep.Score}
                  </td>
                  <td>{rep.Matched_Ideal || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dashboardHistory.length > 0 && (
        <div className="dashboard-section">
          <hr />
          <h2>📊 Performance Dashboard</h2>
          
          <div className="chart-container">
            <h4>Performance Over Time</h4>
            <div className="bar-chart">
              {[...dashboardHistory].reverse().map((session, idx) => (
                <div key={idx} className="bar-wrapper">
                  <div 
                    className="bar" 
                    style={{ height: `${session.score}%` }}
                    title={`${session.exercise}: ${session.score}`}
                  >
                    <span className="bar-label">{session.score}</span>
                  </div>
                  <div className="bar-date">{new Date(session.created_at).toLocaleDateString()}</div>
                </div>
              ))}
            </div>
          </div>

          <h3>Recent Sessions</h3>
          <div className="video-grid">
            {dashboardHistory.map((session) => (
              <div key={session.id} className="video-card session-card">
                <div className="session-info">
                  <strong>{session.exercise}</strong>
                  <span className={`badge ${session.score >= 80 ? 'good' : 'bad'}`}>
                    {session.score}%
                  </span>
                </div>
                <video src={session.overlay_url || session.video_url} controls playsInline loop />
                <small>{new Date(session.created_at).toLocaleString()}</small>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
