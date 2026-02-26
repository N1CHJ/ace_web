import { useState, useEffect, useRef, type ChangeEvent } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
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
  // New Auth State
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  // Existing State
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
  const [showUploadControls, setShowUploadControls] = useState(false);

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
    // Auth bypass for demo
    setIsAuthenticated(true);
    setUsername("Demo Athlete");
    
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
            
            fetchDashboard(); 
            
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

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim()) {
      setIsAuthenticated(true);
    }
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setUsername('');
    setPassword('');
    resetUI();
  };

  // Process data for Recharts
  const chartData = [...dashboardHistory]
    .reverse()
    .map(session => ({
      date: new Date(session.created_at).toLocaleDateString(),
      score: session.score,
      exercise: session.exercise
    }));

  if (!isAuthenticated) {
    return (
      <div className="landing-page">
        <div className="auth-card">
          <h1>Welcome to ACE Athlete</h1>
          <form onSubmit={handleLogin} className="auth-form">
            <input
              type="text"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <div className="auth-buttons">
              <button type="submit">Log In</button>
              <button type="button" onClick={() => setIsAuthenticated(true)}>Sign Up</button>
            </div>
          </form>
          <div className="divider">
            <span>OR</span>
          </div>
          <button className="btn-demo-bypass" onClick={runDemo}>
            Try the Demo
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-layout">
      <header className="dashboard-header">
        <div className="logo">🏋️ ACE Athlete</div>
        <div className="user-nav">
          <span>Welcome, <strong>{username}</strong></span>
          <button onClick={handleLogout} className="btn-logout">Log Out</button>
        </div>
      </header>

      <main className="dashboard-content">
        <div className="dashboard-controls">
          <button 
            className="btn-upload-toggle" 
            onClick={() => setShowUploadControls(!showUploadControls)}
          >
            {showUploadControls ? "Close Upload" : "Upload New Video"}
          </button>

          {showUploadControls && (
            <div className="upload-section card">
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

              <div className="upload-controls-grid">
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
                  <input
                    type="text"
                    placeholder="New sport name"
                    value={customSportName}
                    onChange={(e) => setCustomSportName(e.target.value)}
                    autoFocus
                  />
                )}

                <div className="file-input-wrapper">
                  <input
                    type="file"
                    accept="video/*"
                    onChange={handleFileChange}
                    ref={fileInputRef}
                  />
                </div>

                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={makeOverlay}
                    onChange={(e) => setMakeOverlay(e.target.checked)}
                  />
                  Generate Overlay?
                </label>

                <button className="btn-process" onClick={startProcessing}>Run Processing</button>
              </div>
              {status && <div className="status">{status}</div>}
            </div>
          )}
        </div>

        {/* Current Results Section */}
        {(videoUrls || advice || stats) && (
          <section className="results-section">
            <h2>Current Analysis</h2>
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

            <div className="analysis-details">
              {advice && (
                <div className="feedback-container card">
                  <h3>🤖 Coach's Feedback</h3>
                  <div dangerouslySetInnerHTML={{ __html: formatAdvice(advice) }} />
                </div>
              )}

              {stats && (
                <div className="stats-container card">
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
            </div>
          </section>
        )}

        {/* Performance Chart */}
        <section className="chart-section card">
          <h3>Performance History</h3>
          <div className="chart-wrapper">
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" />
                <YAxis domain={[0, 100]} />
                <Tooltip />
                <Line 
                  type="monotone" 
                  dataKey="score" 
                  stroke="#007bff" 
                  strokeWidth={3} 
                  dot={{ r: 6 }} 
                  activeDot={{ r: 8 }} 
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Recent Sessions */}
        {dashboardHistory.length > 0 && (
          <section className="history-section">
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
                  <div className="session-date">{new Date(session.created_at).toLocaleString()}</div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
