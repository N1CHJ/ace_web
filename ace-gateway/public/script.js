let currentTask = 'analyze';
// Make sure this matches your actual Worker URL
const WORKER_URL = "https://ace-gateway.ace-gateway.workers.dev/api";

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

    if (!fileInput.files[0]) return alert("Select a video!");

    // Reset UI
    statusDiv.innerText = "Starting upload...";
    resultDiv.innerHTML = "";
    if (statsDiv) statsDiv.innerHTML = "";
    
    try {
        const file = fileInput.files[0];

        // --- STEP 1: Upload Raw Video to R2 ---
        statusDiv.innerText = "Uploading to Secure Storage...";
        
        const uploadResponse = await fetch(`${WORKER_URL}/upload?sport=${exerciseName}`, {
            method: "PUT",
            headers: {
                "Content-Type": file.type,
                "X-File-Name": file.name
            },
            body: file // Send raw binary! No Base64 needed.
        });

        if (!uploadResponse.ok) throw new Error("Upload failed");
        const uploadData = await uploadResponse.json();
        const videoKey = uploadData.key;

        console.log("Upload success, key:", videoKey);

        // --- STEP 2: Trigger Analysis with the Key ---
        statusDiv.innerText = "Queuing Analysis Job...";

        const predictResponse = await fetch(`${WORKER_URL}/predict`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                // We pass null for videoUrl because we are using the key now
                videoUrl: null,
                videoKey: videoKey, 
                task: currentTask,
                exerciseName: exerciseName
            })
        });

        const data = await predictResponse.json();
        
        // Catch Replicate specific errors
        if (data.detail) throw new Error(data.detail);
        if (data.error) throw new Error(data.error);
        
        pollStatus(data.id);

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
                
                // 1. Render Video
                resultDiv.innerHTML = `
                    <h3>Analysis Result:</h3>
                    <video src="${output.video}" controls autoplay loop playsinline></video>
                    <p><a href="${output.video}" target="_blank">Download Video</a></p>
                `;

                // 2. Render Stats
                if (output.stats && statsDiv) {
                    try {
                        const statsObj = JSON.parse(output.stats);
                        
                        if (currentTask === 'ingest_reference') {
                            statsDiv.innerHTML = `<div style="background:#eef; padding:10px; border-radius:4px;">
                                <strong>✅ Ingest Complete!</strong><br>
                                Metadata Saved.
                            </div>`;
                        } else {
                            // Build Table
                            let html = `<h3>Rep-by-Rep Scores</h3>
                                        <table>
                                            <thead>
                                                <tr>
                                                    <th>Rep #</th>
                                                    <th>Score</th>
                                                    <th>Matched Ideal</th>
                                                </tr>
                                            </thead>
                                            <tbody>`;
                            
                            statsObj.forEach(rep => {
                                const scoreClass = rep.score >= 80 ? 'score-good' : 'score-bad';
                                html += `<tr>
                                            <td>${rep.rep}</td>
                                            <td class="${scoreClass}">${rep.score}</td>
                                            <td>${rep.match}</td>
                                         </tr>`;
                            });
                            
                            html += `</tbody></table>`;
                            statsDiv.innerHTML = html;
                        }
                    } catch (err) {
                        console.error("Stats parsing error:", err);
                    }
                }
                break;
            } else if (data.status === 'failed') {
                statusDiv.innerText = "Analysis Failed";
                break;
            } else if (data.status === 'canceled') {
                statusDiv.innerText = "Canceled";
                break;
            }
        } catch (e) {
            console.log("Polling error (ignoring):", e);
        }
    }
}