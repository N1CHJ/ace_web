let currentTask = 'analyze';
const WORKER_URL = "https://ace-gateway.ace-gateway.workers.dev/api";
const ADMIN_PASSWORD = "jane"; 

document.addEventListener('DOMContentLoaded', async () => {
    const select = document.getElementById('exerciseName');
    select.innerHTML = '<option>Loading sports...</option>';

    try {
        const res = await fetch(`${WORKER_URL}/config`);
        if (!res.ok) throw new Error("Failed to load config");
        const config = await res.json();
        
        select.innerHTML = ''; 
        Object.keys(config).forEach(sportName => {
            const opt = document.createElement('option');
            opt.value = sportName; // "Golf Drive"
            opt.textContent = sportName;
            select.appendChild(opt);
        });
    } catch (e) {
        console.error("Config Error:", e);
        select.innerHTML = '<option value="Back Squat">Back Squat (Fallback)</option>';
    }
});

function setTask(task, tab) {
    currentTask = task;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
}

async function startProcessing() {
    const exerciseName = document.getElementById('exerciseName').value;
    const fileInput = document.getElementById('videoFile');
    const statusDiv = document.getElementById('status');
    const resultDiv = document.getElementById('result');
    const statsDiv = document.getElementById('stats-output');

    if (currentTask === 'ingest_reference') {
        const userPass = prompt("🔒 Admin Area: Please enter the ingestion password:");
        if (userPass !== ADMIN_PASSWORD) {
            alert("⛔ Access Denied: Incorrect Password.");
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
        
        // Pass "Golf Drive" exactly
        const uploadResponse = await fetch(`${WORKER_URL}/upload?sport=${exerciseName}&task=${currentTask}`, {
            method: "PUT",
            headers: { "Content-Type": file.type, "X-File-Name": file.name },
            body: file 
        });

        if (!uploadResponse.ok) throw new Error("Upload failed");
        const uploadData = await uploadResponse.json();
        const videoKey = uploadData.key;

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

    } catch (e) {
        console.error(e);
        statusDiv.innerText = `Error: ${e.message}`;
    }
}

// ... pollStatus function remains the same ...
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
                statusDiv.innerText = "Analysis Failed/Canceled"; break;
            }
        } catch (e) { console.log("Polling error:", e); }
    }
}