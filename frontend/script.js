let currentTask = 'analyze';
const WORKER_URL = "https://ace-worker.ace-gateway.workers.dev/api";
const ADMIN_PASSWORD = "jane"; 

document.addEventListener('DOMContentLoaded', async () => {
    loadSports();
});

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

async function startProcessing() {
    const select = document.getElementById('exerciseName');
    let exerciseName = select.value;
    const fileInput = document.getElementById('videoFile');
    const statusDiv = document.getElementById('status');
    const resultDiv = document.getElementById('result');
    const statsDiv = document.getElementById('stats-output');
    const feedbackDiv = document.getElementById('ai-feedback'); // New Div

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
    resultDiv.innerHTML = "";
    if (statsDiv) statsDiv.innerHTML = "";
    if (feedbackDiv) feedbackDiv.innerHTML = "Waiting for AI Coach..."; // Reset feedback

    try {
        const file = fileInput.files[0];
        const uploadResponse = await fetch(`${WORKER_URL}/upload?sport=${encodeURIComponent(exerciseName)}&task=${currentTask}`, {
            method: "PUT",
            headers: { "Content-Type": file.type, "X-File-Name": file.name },
            body: file 
        });
        if (!uploadResponse.ok) throw new Error("Upload failed");
        const { key: videoKey } = await uploadResponse.json();

        statusDiv.innerText = "Queuing Analysis Job...";
        const predictResponse = await fetch(`${WORKER_URL}/predict`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ videoKey, task: currentTask, exerciseName })
        });

        const data = await predictResponse.json();
        pollStatus(data.id);
        
        if (select.value === "NEW_SPORT_ENTRY") setTimeout(loadSports, 2000); 

    } catch (e) {
        console.error(e);
        statusDiv.innerText = `Error: ${e.message}`;
    }
}

async function pollStatus(id) {
    const statusDiv = document.getElementById('status');
    const resultDiv = document.getElementById('result');
    const statsDiv = document.getElementById('stats-output');
    const feedbackDiv = document.getElementById('ai-feedback');

    while (true) {
        await new Promise(r => setTimeout(r, 2000));
        try {
            const res = await fetch(`${WORKER_URL}/status?id=${id}`);
            const data = await res.json();
            statusDiv.innerText = `Status: ${data.status}`;
            
            if (data.status === 'succeeded') {
                const output = data.output;
                
                // 1. Render Video
                if (output.video) {
                    resultDiv.innerHTML = `<h3>Analysis Result:</h3><video src="${output.video}" controls autoplay loop playsinline></video><p><a href="${output.video}" target="_blank">Download Video</a></p>`;
                }
                
                // 2. Render Stats
                if (output.stats && statsDiv) {
                    try {
                        const statsObj = JSON.parse(output.stats);
                        if (currentTask === 'ingest_reference') {
                            statsDiv.innerHTML = `<div style="background:#eef; padding:10px;"><strong>✅ Ingest Complete!</strong></div>`;
                        } else {
                            let html = `<h3>Rep-by-Rep Scores</h3><table><thead><tr><th>Rep</th><th>Score</th><th>Match</th></tr></thead><tbody>`;
                            statsObj.reps.forEach(rep => {
                                html += `<tr><td>${rep.rep}</td><td class="${rep.score >= 80 ? 'score-good' : 'score-bad'}">${rep.score}</td><td>${rep.match}</td></tr>`;
                            });
                            html += `</tbody></table>`;
                            statsDiv.innerHTML = html;

                            // 3. FETCH AI FEEDBACK (Only if analysis)
                            if (feedbackDiv) {
                                feedbackDiv.innerHTML = "<em>🤖 AI Coach is typing...</em>";
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

// New function to poll specifically for the Gemini text
async function pollFeedback(id) {
    const feedbackDiv = document.getElementById('ai-feedback');
    let attempts = 0;
    
    // Increased to 20 attempts (approx 40 seconds)
    while (attempts < 20) { 
        await new Promise(r => setTimeout(r, 2000));
        try {
            const res = await fetch(`${WORKER_URL}/feedback?id=${id}`);
            if (res.ok) {
                const data = await res.json();
                
                // If the worker explicitly told us it failed/skipped
                if (data.status === "skipped" || data.error) {
                    feedbackDiv.innerHTML = `<div style="color:red; background:#fee; padding:10px; border-radius:4px;">
                        ⚠️ AI Analysis Skipped: ${data.reason || "Unknown Error"}
                    </div>`;
                    return;
                }

                if (data.advice) {
                    const html = data.advice.replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
                    feedbackDiv.innerHTML = `<div style="background:#f0f8ff; border:1px solid #007bff; padding:15px; border-radius:8px; margin-top:20px;">
                        <h3 style="margin-top:0;">🤖 Coach's Feedback</h3>
                        <div style="line-height:1.6;">${html}</div>
                        <small style="color:#777;">Generated via AI</small>
                    </div>`;
                    return;
                }
            }
        } catch (e) { console.log("Waiting for feedback..."); }
        attempts++;
    }
    feedbackDiv.innerHTML = "<em>(Coach timed out. Check Worker Logs.)</em>";
}