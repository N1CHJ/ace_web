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
  overlay_url?: string;
  ideal_url?: string;
  created_at: string;
  stats?: string;
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

const HoverVideo = ({ src, className, onClick }: { src: string; className?: string; onClick?: () => void }) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  const handleMouseEnter = () => {
    videoRef.current?.play().catch(() => {});
  };

  const handleMouseLeave = () => {
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  };

  return (
    <video
      ref={videoRef}
      src={src}
      className={className}
      muted
      playsInline
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={onClick}
    />
  );
};

function App() {
  // New Auth State
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [activeView, setActiveView] = useState<'dashboard' | 'analyze' | 'sessions'>('dashboard');

  // New Dashboard States
  const [sportFilter, setSportFilter] = useState('All');
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [isSeeding, setIsSeeding] = useState(false);

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

  const fileInputRef = useRef<HTMLInputElement>(null);

  const seedMockData = async () => {
    setIsSeeding(true);
    try {
      const res = await fetch(`${WORKER_URL}/seed-mock-data`, { method: "POST" });
      if (res.ok) {
        alert("60 sessions seeded successfully!");
        fetchDashboard();
      }
    } catch (e) {
      console.error("Seeding error:", e);
    } finally {
      setIsSeeding(false);
    }
  };

  const handleDeleteSession = async (id: string) => {
    if (window.confirm("Are you sure you want to permanently delete this session?")) {
      try {
        const res = await fetch(`${WORKER_URL}/session?id=${id}`, {
          method: 'DELETE'
        });
        
        if (res.ok) {
          // Remove from local state
          setDashboardHistory(prev => prev.filter(s => s.id !== id));
          // Route back to previous view
          setSelectedSession(null);
        } else {
          alert("Failed to delete session from the database.");
        }
      } catch (e) {
        console.error("Delete request failed:", e);
      }
    }
  };

  const filteredHistory = sportFilter === 'All' 
    ? dashboardHistory 
    : dashboardHistory.filter(s => s.exercise === sportFilter);

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
        setActiveView('dashboard');
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
    setActiveView('dashboard');
  };

  // --- Dashboard Data Transformations ---

  // Grouped by day for Line Chart (Average Score vs. Date)
  const chartData = Object.values(
    filteredHistory.reduce((acc, session) => {
      const dateStr = new Date(session.created_at).toISOString().split('T')[0];
      if (!acc[dateStr]) acc[dateStr] = { dateStr, score: 0, count: 0 };
      acc[dateStr].score += session.score;
      acc[dateStr].count += 1;
      return acc;
    }, {} as Record<string, { dateStr: string; score: number; count: number }>)
  )
    .sort((a, b) => a.dateStr.localeCompare(b.dateStr))
    .map(d => ({
      date: new Date(d.dateStr + 'T00:00:00').toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric' 
      }),
      score: Math.round(d.score / d.count)
    }));

  // Heatmap Data (Activity frequency over the last 12 weeks = 84 days)
  const getHeatmapData = () => {
    const today = new Date();
    const heatmap = [];
    const activityMap = filteredHistory.reduce((acc, session) => {
      const dateStr = new Date(session.created_at).toISOString().split('T')[0];
      acc[dateStr] = (acc[dateStr] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    for (let i = 83; i >= 0; i--) {
      const d = new Date();
      d.setDate(today.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      heatmap.push({
        date: dateStr,
        count: activityMap[dateStr] || 0
      });
    }
    return heatmap;
  };

  // KPI Calculations
  const allTimeBest = [...filteredHistory].sort((a, b) => b.score - a.score)[0];
  const sortedHistory = [...filteredHistory].sort((a, b) => 
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  const overallAvg = filteredHistory.length 
    ? Math.round(filteredHistory.reduce((acc, s) => acc + s.score, 0) / filteredHistory.length) 
    : 0;
  const latestSession = sortedHistory[0];
  const latestNote = latestSession?.advice || "No sessions yet.";

  const availableSports = ["All", ...new Set(dashboardHistory.map(s => s.exercise))];

  if (!isAuthenticated) {
    return (
      <div className="landing-page">
        <div className="auth-card">
          <h1>ACE Athlete</h1>
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
    <div className="app-container">
      <nav className="sidebar">
        <div className="sidebar-header">
          <span className="sidebar-logo">ACE Athlete</span>
        </div>
        <div className="sidebar-menu">
          <button 
            className={`menu-item ${activeView === 'dashboard' ? 'active' : ''}`}
            onClick={() => { setActiveView('dashboard'); setSelectedSession(null); }}
          >
            📊 Dashboard
          </button>
          <button 
            className={`menu-item ${activeView === 'sessions' ? 'active' : ''}`}
            onClick={() => { setActiveView('sessions'); setSelectedSession(null); }}
          >
            📋 Workout Sessions
          </button>
          <button 
            className={`menu-item ${activeView === 'analyze' ? 'active' : ''}`}
            onClick={() => { setActiveView('analyze'); setSelectedSession(null); }}
          >
            📹 Analyze Video
          </button>
        </div>
        <div className="sidebar-footer">
          <button onClick={handleLogout} className="btn-logout">Log Out</button>
        </div>
      </nav>

                        <main className="main-content">
                          {selectedSession ? (
                            <div className="detailed-session-view">
                              <div className="drilldown-actions">
                                <button className="btn-back" onClick={() => setSelectedSession(null)}>
                                  ← Back
                                </button>
                                <button className="btn-delete" onClick={() => handleDeleteSession(selectedSession.id)}>
                                  Delete Session
                                </button>
                              </div>
                              
                              <div className="drilldown-header">
                  
                          <h2>{selectedSession.exercise} Analysis</h2>
                          <span className="drilldown-date">
                            {new Date(selectedSession.created_at).toLocaleString()}
                          </span>
                        </div>
            
                                    <div className="drilldown-grid">
                                      <div className="drilldown-video-card card">
                                        <video 
                                          className="detailed-video-player"
                                          src={selectedSession.overlay_url || selectedSession.video_url} 
                                          muted autoPlay loop playsInline 
                                        />
                                      </div>
                        
                                      <div className="drilldown-info">                            <div className="feedback-container card">
                              <h3>🤖 Coach's Feedback</h3>
                              <div dangerouslySetInnerHTML={{ __html: formatAdvice(selectedSession.advice) }} />
                            </div>
            
                            {selectedSession.stats && (
                              <div className="stats-container card">
                                <h3>Rep-by-Rep Scores</h3>
                                <table>
                                  <thead>
                                    <tr>
                                      <th>Rep</th>
                                      <th>Score</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {JSON.parse(selectedSession.stats).reps.map((rep: any, idx: number) => (
                                      <tr key={idx}>
                                        <td>{rep.Rep}</td>
                                        <td className={rep.Score >= 80 ? 'score-good' : 'score-bad'}>
                                          {rep.Score}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <>
                                    {activeView === 'dashboard' && (
                                      <div className="dashboard-grid-layout">
                                        <div className="dashboard-controls">
                                          <button 
                                            className="btn-seed" 
                                            onClick={seedMockData} 
                                            disabled={isSeeding}
                                          >
                                            {isSeeding ? "Seeding..." : "Seed Mock Data"}
                                          </button>
                                        </div>
                        
                                        <div className="dashboard-main-column">
                                          <section className="heatmap-section card">
                                            <div className="heatmap-header">
                                              <h3>Activity Heatmap</h3>
                                              <div className="heatmap-months">
                                                <span>Jan</span>
                                                <span>Feb</span>
                                                <span>Mar</span>
                                              </div>
                                            </div>
                                            <div className="heatmap-grid">
                                              {getHeatmapData().map((day, idx) => (
                                                <div 
                                                  key={idx} 
                                                  className={`heatmap-cell level-${Math.min(day.count, 4)}`}
                                                  title={`${day.date}: ${day.count} sessions`}
                                                />
                                              ))}
                                            </div>
                                            <div className="heatmap-legend">
                                              <span>Less</span>
                                              <div className="heatmap-cell level-0" />
                                              <div className="heatmap-cell level-1" />
                                              <div className="heatmap-cell level-2" />
                                              <div className="heatmap-cell level-3" />
                                              <div className="heatmap-cell level-4" />
                                              <span>More</span>
                                            </div>
                                          </section>
                        
                                          <div className="sport-filters">
                                            {availableSports.map(sport => (
                                              <button
                                                key={sport}
                                                className={`filter-pill ${sportFilter === sport ? 'active' : ''}`}
                                                onClick={() => setSportFilter(sport)}
                                              >
                                                {sport}
                                              </button>
                                            ))}
                                          </div>
                        
                                          <section className="chart-section card">
                                            <h3>Average Score Trend</h3>
                                            <div className="chart-wrapper">
                                              <ResponsiveContainer width="100%" height={250}>
                                                <LineChart data={chartData}>
                                                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#3f3f4d" />
                                                  <XAxis dataKey="date" stroke="#a0a0b0" fontSize={12} />
                                                  <YAxis domain={[0, 100]} stroke="#a0a0b0" fontSize={12} />
                                                  <Tooltip 
                                                    contentStyle={{ backgroundColor: '#2b2b36', borderColor: '#3f3f4d', color: '#fff' }}
                                                    itemStyle={{ color: '#00d2ff' }}
                                                  />
                                                  <Line 
                                                    type="monotone" 
                                                    dataKey="score" 
                                                    stroke="#00d2ff" 
                                                    strokeWidth={3} 
                                                    dot={{ r: 4, fill: '#00d2ff' }} 
                                                    activeDot={{ r: 6, stroke: '#fff' }} 
                                                  />
                                                </LineChart>
                                              </ResponsiveContainer>
                                            </div>
                                          </section>
                        
                                          <section className="history-row">
                                            <h3>Recent Sessions</h3>
                                            <div className="recent-sessions-grid">
                                              {filteredHistory.slice(0, 8).map((session) => (
                                                <div 
                                                  key={session.id} 
                                                  className="session-thumbnail-card"
                                                  onClick={() => setSelectedSession(session)}
                                                >
                                                  <HoverVideo 
                                                    src={session.overlay_url || session.video_url} 
                                                    className="session-hover-video"
                                                  />
                                                  <div className="session-thumb-info">
                                                    <span className="session-thumb-exercise">{session.exercise}</span>
                                                    <span className="session-thumb-score">{session.score}%</span>
                                                  </div>
                                                </div>
                                              ))}
                                            </div>
                                          </section>
                                        </div>
                        
                                        <div className="dashboard-side-column">
                                          <div className="kpi-card best-form-card card">
                                            <h4>All-Time Best Form</h4>
                                            {allTimeBest ? (
                                              <>
                                                <video 
                                                  src={allTimeBest.overlay_url || allTimeBest.video_url} 
                                                  muted autoPlay loop playsInline 
                                                  onClick={() => setSelectedSession(allTimeBest)}
                                                  className="cursor-pointer"
                                                />
                                                <div className="kpi-value">{allTimeBest.score}%</div>
                                                <div className="kpi-label">{allTimeBest.exercise}</div>
                                              </>
                                            ) : <p>No sessions yet</p>}
                                          </div>
                        
                        <div className="kpi-card card">
                          <h4>Overall Average Score</h4>
                          <div className="kpi-value-large">{overallAvg}%</div>
                          <div className="kpi-subtitle">{sportFilter === 'All' ? 'All Sports' : sportFilter}</div>
                          <div className="kpi-label">Across {filteredHistory.length} sessions</div>
                        </div>

                        <div className="kpi-card card latest-note-card">
                          <h4>Latest Coach Note</h4>
                          {latestSession && (
                            <>
                              <div className="kpi-subtitle" style={{ marginBottom: '10px', color: 'var(--primary)' }}>
                                {latestSession.exercise}
                              </div>
                              <div 
                                className="advice-text"
                                dangerouslySetInnerHTML={{ __html: formatAdvice(latestNote) }} 
                              />
                              <HoverVideo 
                                src={latestSession.overlay_url || latestSession.video_url} 
                                className="coach-note-video"
                                onClick={() => setSelectedSession(latestSession)}
                              />
                            </>
                          )}
                          {!latestSession && (
                            <div 
                              className="advice-text"
                              dangerouslySetInnerHTML={{ __html: formatAdvice(latestNote) }} 
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                                                {activeView === 'sessions' && (
                          <div className="sessions-view">
                            <div className="sessions-header">
                              <h2>Workout Sessions</h2>
                              <div className="sport-filters">
                                {availableSports.map(sport => (
                                  <button
                                    key={sport}
                                    className={`filter-pill ${sportFilter === sport ? 'active' : ''}`}
                                    onClick={() => setSportFilter(sport)}
                                  >
                                    {sport}
                                  </button>
                                ))}
                              </div>
                            </div>
                            
                            <div className="sessions-table-card card">
                              <table className="sessions-table">
                                <thead>
                                  <tr>
                                    <th>Date & Time</th>
                                    <th>Exercise</th>
                                    <th>Reps</th>
                                    <th>Average Score</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {filteredHistory.map((session) => {
                                    let repsCount = "N/A";
                                    if (session.stats) {
                                      try {
                                        const parsed = JSON.parse(session.stats);
                                        if (parsed.reps) repsCount = parsed.reps.length;
                                      } catch (e) {}
                                    }
                                    return (
                                      <tr 
                                        key={session.id} 
                                        onClick={() => setSelectedSession(session)}
                                        className="interactive-row"
                                      >
                                        <td>{new Date(session.created_at).toLocaleString()}</td>
                                        <td>{session.exercise}</td>
                                        <td>{repsCount}</td>
                                        <td className="score-cell">{session.score}%</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
            
                        {activeView === 'analyze' && (
            
      
          <div className="analyze-view">
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
          </div>
        )}
        </>
      )}
      </main>
    </div>
  );
}

export default App;
