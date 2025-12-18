let currentTask = 'analyze';
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

    if (!fileInput.files[0]) return alert("Select a video!");

    statusDiv.innerText = "Encoding video...";
    resultDiv.innerHTML = "";
    
    try {
        const dataUri = await readFileAsDataURL(fileInput.files[0]);
        statusDiv.innerText = "Sending to Secure Gateway...";

        const response = await fetch(`${WORKER_URL}/predict`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                videoUrl: dataUri,
                task: currentTask,
                exerciseName: exerciseName
            })
        });

        const data = await response.json();
        if (data.error) throw new Error(data.error);
        
        pollStatus(data.id);

    } catch (e) {
        statusDiv.innerText = `Error: ${e.message}`;
    }
}

async function pollStatus(id) {
    const statusDiv = document.getElementById('status');
    const resultDiv = document.getElementById('result');

    while (true) {
        await new Promise(r => setTimeout(r, 2000));
        const res = await fetch(`${WORKER_URL}/status?id=${id}`);
        const data = await res.json();
        
        statusDiv.innerText = `Status: ${data.status}`;
        
        if (data.status === 'succeeded') {
            const output = data.output;
            resultDiv.innerHTML = `<video src="${output.video}" controls autoplay loop></video>`;
            break;
        } else if (data.status === 'failed') {
            statusDiv.innerText = "Analysis Failed";
            break;
        }
    }
}

function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}