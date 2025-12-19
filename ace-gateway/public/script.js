let currentTask = 'analyze';
const WORKER_URL = "https://ace-gateway.ace-gateway.workers.dev/api";
const ADMIN_PASSWORD = "jane"; 

document.addEventListener('DOMContentLoaded', async () => {
    loadSports();
});

async function loadSports() {
    const select = document.getElementById('exerciseName');
    select.innerHTML = '<option>Loading sports...</option>';

    try {
        const res = await fetch(`${WORKER_URL}/config`);
        if (!res.ok) throw new Error("Failed to load config");
        const config = await res.json();
        
        select.innerHTML = ''; 
        
        // 1. Add Existing Sports
        Object.keys(config).forEach(sportName => {
            const opt = document.createElement('option');
            opt.value = sportName; 
            opt.textContent = sportName;
            select.appendChild(opt);
        });

        // 2. Add "Create New" Option at the bottom
        const separator = document.createElement('option');
        separator.disabled = true;
        separator.textContent = "──────────";
        select.appendChild(separator);

        const newOpt = document.createElement('option');
        newOpt.value = "NEW_SPORT_ENTRY";
        newOpt.textContent = "➕ Create New Sport...";
        select.appendChild(newOpt);

    } catch (e) {
        console.error("Config Error:", e);
        select.innerHTML = '<option value="Back Squat">Back Squat (Fallback)</option>';
    }
}

// Show/Hide Text Input based on Dropdown
function checkCustomOption(selectElement) {
    const customContainer = document.getElementById('customInputContainer');
    if (selectElement.value === "NEW_SPORT_ENTRY") {
        customContainer.classList.remove('hidden');
        document.getElementById('customSportName').focus();
    } else {
        customContainer.classList.add('hidden');
    }
}

// Helper: Title Case (e.g. "cricket bowl" -> "Cricket Bowl")
function toTitleCase(str) {
    return str.replace(
        /\w\S*/g,
        text => text.charAt(0).toUpperCase() + text.substring(1).toLowerCase()
    );
}

function setTask(task, tab) {
    currentTask = task;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    
    // Reset dropdown if switching tasks
    const select = document.getElementById('exerciseName');
    const customContainer = document.getElementById('customInputContainer');
    
    if (task === 'analyze') {
        // Hide custom input in analyze mode (usually users don't create sports)
        customContainer.classList.add('hidden');
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

    // --- HANDLE CUSTOM SPORT ---
    if (exerciseName === "NEW_SPORT_ENTRY") {
        const rawName = document.getElementById('customSportName').value.trim();
        if (!rawName) return alert("Please enter a name for the new sport.");
        // Auto-format to Title Case for cleaner config
        exerciseName = toTitleCase(rawName);
    }

    // --- ADMIN CHECK ---
    if (currentTask === 'ingest_reference') {
        const userPass = prompt("🔒 Admin Area: Please enter the ingestion password:");
        if (userPass !== ADMIN_PASSWORD) {
            alert("⛔ Access Denied: Incorrect Password.");
            return;
        }
    } else {
        // Prevent users from trying to analyze a "New" sport that doesn't exist yet
        // (Though the logic handles it, it's good UX to block it)
        if (select.value === "NEW_SPORT_ENTRY") {
            alert("⚠️ You cannot analyze a new sport until you upload a reference video for it first.");
            return;
        }
    }

    if (!fileInput.files[0]) return alert("Select a video!");

    statusDiv.innerText = "Starting upload...";
    resultDiv.innerHTML = "";
    if (statsDiv) statsDiv.innerHTML = "";
    
    try {
        const file = fileInput.files[0];
        statusDiv.innerText = "Uploading to Secure Storage...";
        
        // Upload (Worker will handle config update if needed)
        const uploadResponse = await fetch(`${WORKER_URL}/upload?sport=${encodeURIComponent(exerciseName)}&task=${currentTask}`, {
            method: "PUT",
            headers: {
                "Content-Type": file.type,
                "X-File-Name": file.name
            },
            body: file 
        });

        if (!uploadResponse.ok) throw new Error("Upload failed");
        const uploadData = await uploadResponse.json();
        const videoKey = uploadData.key;

        console.log("Upload success, key:", videoKey);

        statusDiv.innerText = "Queuing Analysis Job...";

        const predictResponse = await fetch(`${WORKER_URL}/predict`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                videoUrl: null,
                videoKey: videoKey, 
                task: currentTask,
                exerciseName: exerciseName
            })
        });

        const data = await predictResponse.json();
        if (data.detail) throw new Error(data.detail);
        if (data.error) throw new Error(data.error);
        
        pollStatus(data.id);
        
        // If we just created a new sport, reload the dropdown so it appears
        if (select.value === "NEW_SPORT_ENTRY") {
            setTimeout(loadSports, 2000); 
        }

    } catch (e) {
        console.error(e);
        statusDiv.innerText = `Error: ${e.message}`;
    }
}

async function pollStatus(id) {
    const statusDiv = document.getElementById('status');
    const resultDiv = document.getElementById('result');
    const statsDiv = document.getElementById('stats-output');

    while (true) {
        await new Promise(r => setTimeout(r, 2000));
        try {
            const res = await fetch(`${WORKER_URL}/status?id=${id}`);
            const data = await res.json();
            statusDiv.innerText = `Status: ${data.status}`;
            
            if (data.status === 'succeeded') {
                const output = data.output;
                if (output.video) {
                    resultDiv.innerHTML = `<h3>Analysis Result:</h3><video src="${output.video}" controls autoplay loop playsinline></video><p><a href="${output.video}" target="_blank">Download Video</a></p>`;
                }
                if (output.stats && statsDiv) {
                    try {
                        const statsObj = JSON.parse(output.stats);
                        if (currentTask === 'ingest_reference') {
                            statsDiv.innerHTML = `<div style="background:#eef; padding:10px; border-radius:4px; margin-top: 10px;"><strong>✅ Ingest Complete!</strong><br>Metadata Saved.<br><small>Key: ${statsObj.meta.name}</small></div>`;
                        } else {
                            let html = `<h3>Rep-by-Rep Scores</h3><table><thead><tr><th>Rep #</th><th>Score</th><th>Matched Ideal</th></tr></thead><tbody>`;
                            statsObj.reps.forEach(rep => {
                                const scoreClass = rep.score >= 80 ? 'score-good' : 'score-bad';
                                html += `<tr><td>${rep.rep}</td><td class="${scoreClass}">${rep.score}</td><td>${rep.match}</td></tr>`;
                            });
                            html += `</tbody></table>`;
                            statsDiv.innerHTML = html;
                        }
                    } catch (err) { console.error("Stats parsing error:", err); }
                }
                break;
            } else if (data.status === 'failed' || data.status === 'canceled') {
                statusDiv.innerText = "Analysis Failed"; break;
            }
        } catch (e) { console.log("Polling error:", e); }
    }
}