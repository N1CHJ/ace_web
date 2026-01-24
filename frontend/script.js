let currentTask = 'analyze';
const WORKER_URL = "https://ace-worker.ace-gateway.workers.dev/api";
const ADMIN_PASSWORD = "jane"; 

document.addEventListener('DOMContentLoaded', async () => {
    loadSports();
});

async function runDemo() {
    alert("Demo Mode: For the updated 3-video view, please run a fresh upload!");
}

async function loadSports() {
    const select = document.getElementById('exerciseName');
    select.innerHTML = '<option>Loading sports...</option>';
    try {
        const res = await fetch(`${WORKER_URL}/config`);
        if (!res.ok) throw new Error("Failed");
        const config = await res.json();
        select.innerHTML = ''; 
        Object.keys(config).forEach(sportName => {
            const opt = document.createElement('option');
            opt.value = sportName; opt.textContent = sportName;
            select.appendChild(opt);
        });
        const separator = document.createElement('option');
        separator.disabled = true; separator.textContent = "──────────";
        select.appendChild(separator);
        const newOpt = document.createElement('option');
        newOpt.value = "NEW_SPORT_ENTRY"; newOpt.textContent = "➕ Create New Sport...";
        select.appendChild(newOpt);
    } catch (e) {
        select.innerHTML = '<option value="Back Squat">Back Squat (Fallback)</option>';
    }
}

function checkCustomOption(selectElement) {
    const customContainer = document.getElementById('customInputContainer');
    if (selectElement.value === "NEW_SPORT_ENTRY") {
        customContainer.classList.remove('hidden');
        document.getElementById('customSportName').focus();
    } else {
        customContainer.classList.add('hidden');
    }
}

function toTitleCase(str) {
    return str.replace(/\w\S*/g, text => text.charAt(0).toUpperCase() + text.substring(1).toLowerCase());
}

function setTask(task, tab) {
    currentTask = task;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    if (task === 'analyze') {
        document.getElementById('customInputContainer').classList.add('hidden');
        const select = document.getElementById('exerciseName');
        if (select.value === "NEW_SPORT_ENTRY") select.selectedIndex = 0;
    }
}

async function startProcessing(isDemo = false) {
    let exerciseName = document.getElementById('exerciseName').value;
    const fileInput = document.getElementById('videoFile');
    const statusDiv = document.getElementById('status');
    const videoResultsDiv = document.getElementById('video-results');
    const statsDiv = document.getElementById('stats-output');
    const feedbackDiv = document.getElementById('ai-feedback');
    
    // NEW: Get Checkbox State
    const makeOverlay = document.getElementById('chkOverlay').checked;

    let videoKey = null;

    if (!isDemo) {
        if (exerciseName === "NEW_SPORT_ENTRY") {
            const rawName = document.getElementById('customSportName').value.trim();
            if (!rawName) return alert("Enter a name.");
            exerciseName = toTitleCase(rawName);
        }

        if (currentTask === 'ingest_reference') {
            if (prompt("🔒 Password:") !== ADMIN_PASSWORD) return alert("Incorrect Password.");
        }

        if (!fileInput.files[0]) return alert("Select a video!");

        statusDiv.innerText = "Starting upload...";
        const file = fileInput.files[0];
        const uploadResponse = await fetch(`${WORKER_URL}/upload?sport=${encodeURIComponent(exerciseName)}&task=${currentTask}`, {
            method: "PUT",
            headers: { "Content-Type": file.type, "X-File-Name": file.name },
            body: file 
        });
        if (!uploadResponse.ok) throw new Error("Upload failed");
        const json = await uploadResponse.json();
        videoKey = json.key;
    }

    // Reset UI
    videoResultsDiv.innerHTML = "";
    if (statsDiv) statsDiv.innerHTML = "";
    if (feedbackDiv) feedbackDiv.innerHTML = "Waiting for ACE..."; 

    statusDiv.innerText = "Queuing Analysis Job...";
    try {
        const predictResponse = await fetch(`${WORKER_URL}/predict`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                videoKey: videoKey, 
                task: currentTask, 
                exerciseName: exerciseName,
                makeOverlay: makeOverlay, 
                is_demo: isDemo 
            })
        });

        const data = await predictResponse.json();
        pollStatus(data.id);
        
        if (!isDemo && document.getElementById('exerciseName').value === "NEW_SPORT_ENTRY") setTimeout(loadSports, 2000); 

    } catch (e) {
        console.error(e);
        statusDiv.innerText = `Error: ${e.message}`;
    }
}

function renderStats(statsObj) {
    const statsDiv = document.getElementById('stats-output');
    if (!statsDiv) return;
    
    let html = `<h3>Rep-by-Rep Scores</h3><table><thead><tr><th>Rep</th><th>Score</th><th>Match</th></tr></thead><tbody>`;
    statsObj.reps.forEach(rep => {
        html += `<tr>
            <td>${rep.Rep}</td>
            <td class="${rep.Score >= 80 ? 'score-good' : 'score-bad'}">${rep.Score}</td>
            <td>${rep.Matched_Ideal || '-'}</td>
        </tr>`;
    });
    html += `</tbody></table>`;
    statsDiv.innerHTML = html;
}

async function pollStatus(id) {
    const statusDiv = document.getElementById('status');
    const feedbackDiv = document.getElementById('ai-feedback');

    while (true) {
        await new Promise(r => setTimeout(r, 2000));
        try {
            // Added cache buster here too just in case
            const res = await fetch(`${WORKER_URL}/status?id=${id}&_t=${Date.now()}`);
            const data = await res.json();
            statusDiv.innerText = `Status: ${data.status}`;
            
            if (data.status === 'succeeded') {
                const output = data.output;
                
                if (output.stats) {
                    try {
                        const statsObj = JSON.parse(output.stats);
                        if (currentTask === 'ingest_reference') {
                            document.getElementById('stats-output').innerHTML = `<div style="background:#eef; padding:10px;"><strong>✅ Ingest Complete!</strong></div>`;
                        } else {
                            renderStats(statsObj);
                            
                            // Trigger Feedback & Video Rendering
                            if (feedbackDiv) {
                                feedbackDiv.innerHTML = "<em>🤖 ACE is analyzing results...</em>";
                                pollFeedback(id); 
                            }
                        }
                    } catch (err) { console.error(err); }
                }
                break;
            } else if (data.status === 'failed' || data.status === 'canceled') {
                statusDiv.innerText = "Analysis Failed"; break;
            }
        } catch (e) { console.log("Polling error:", e); }
    }
}

async function pollFeedback(id) {
    const feedbackDiv = document.getElementById('ai-feedback');
    const videoResultsDiv = document.getElementById('video-results');
    let attempts = 0;
    
    // Increased attempts to 30 (60 seconds) just to be safe
    while (attempts < 30) { 
        await new Promise(r => setTimeout(r, 2000));
        try {
            // FIX: Added "&_t=${Date.now()}" to force browser to ignore cache
            const res = await fetch(`${WORKER_URL}/feedback?id=${id}&_t=${Date.now()}`);
            
            if (res.ok) {
                const data = await res.json();
                
                // If status is pending, we loop again.
                // We do NOT use 'continue' here because we want to hit attempts++ at the bottom
                if (data.status === "succeeded") {
                    
                    // --- 1. RENDER VIDEO GRID ---
                    if (data.urls) {
                        let gridHtml = '<div class="video-grid">';
                        
                        if (data.urls.uploaded) {
                            gridHtml += `
                                <div class="video-card">
                                    <h4>Your Video</h4>
                                    <video src="${data.urls.uploaded}" controls playsinline loop></video>
                                </div>`;
                        }

                        if (data.urls.overlay) {
                            gridHtml += `
                                <div class="video-card">
                                    <h4>AI Overlay</h4>
                                    <video src="${data.urls.overlay}" controls playsinline loop></video>
                                </div>`;
                        }

                        if (data.urls.ideal) {
                            gridHtml += `
                                <div class="video-card">
                                    <h4>Pro Reference</h4>
                                    <video src="${data.urls.ideal}" controls playsinline loop></video>
                                </div>`;
                        }
                        
                        gridHtml += '</div>';
                        if (videoResultsDiv) videoResultsDiv.innerHTML = gridHtml;
                    }

                    // --- 2. RENDER ADVICE ---
                    if (data.advice) {
                        const html = data.advice.replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
                        feedbackDiv.innerHTML = `<div style="background:#f0f8ff; border:1px solid #007bff; padding:15px; border-radius:8px; margin-top:20px;">
                            <h3 style="margin-top:0;">🤖 Coach's Feedback</h3>
                            <div style="line-height:1.6;">${html}</div>
                            <small style="color:#777;">Generated via ACE</small>
                        </div>`;
                    }
                    
                    return; // EXIT FUNCTION ON SUCCESS
                }
            }
        } catch (e) { 
            console.error("Feedback polling error:", e); 
            // We don't return here, we let it retry
        }
        attempts++;
    }
    
    feedbackDiv.innerHTML = "<em>(Coach timed out. Check console for errors.)</em>";
}