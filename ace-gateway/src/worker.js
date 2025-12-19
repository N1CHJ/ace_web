// src/worker.js

const WEBHOOK_URL = "https://ace-gateway.ace-gateway.workers.dev/api/webhook";
const CONFIG_KEY = "system/config.json";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-File-Name",
    };

    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    // --- HELPER: Fetch Config ---
    async function getSystemConfig() {
      if (!env.ACE_BUCKET) throw new Error("No Bucket Bound");
      const obj = await env.ACE_BUCKET.get(CONFIG_KEY);
      if (!obj) return {}; // Return empty object if missing
      return await obj.json();
    }

    // --- HELPER: Save Config ---
    async function saveSystemConfig(config) {
      await env.ACE_BUCKET.put(CONFIG_KEY, JSON.stringify(config, null, 2));
    }

    // ------------------------------------------------------------------
    // 0. CONFIG ROUTE
    // ------------------------------------------------------------------
    if (request.method === "GET" && url.pathname.endsWith("/config")) {
        const config = await getSystemConfig();
        return new Response(JSON.stringify(config), { headers: corsHeaders });
    }

    // ------------------------------------------------------------------
    // 1. UPLOAD ROUTE (Auto-Update Config)
    // ------------------------------------------------------------------
    if (request.method === "PUT" && url.pathname.endsWith("/upload")) {
      const task = url.searchParams.get("task");
      const sportName = url.searchParams.get("sport"); // "Cricket Bowl"
      
      let config = await getSystemConfig();
      let folderName = "uncategorized";

      // 1. Check if sport exists
      if (config && config[sportName]) {
          // It exists, use the folder
          folderName = config[sportName].folder;
      } else {
          // 2. NEW SPORT DETECTED!
          // Create safe folder name: "Cricket Bowl" -> "Cricket_Bowl"
          folderName = sportName.trim().replace(/\s+/g, "_");
          
          // Create Default Settings
          const newEntry = {
              "folder": folderName,
              "rotation": "None", // Default to auto-detect (handled by FFmpeg in predict.py)
              "rep_settings": {
                  "metric": "knee_angle", // Safe default
                  "method": "peaks",
                  "min_dist_frames": 30,
                  "prominence": 20
              },
              "dtw_settings": {
                  "anchor_metric": "knee_angle",
                  "anchor_method": "min"
              },
              "safety_checks": [] // No checks initially
          };

          // Update Config Object
          config[sportName] = newEntry;

          // SAVE to R2 (This updates the dropdown for everyone!)
          await saveSystemConfig(config);
          console.log(`✅ Added new sport '${sportName}' to config.`);
      }

      const originalName = request.headers.get("X-File-Name") || "video.mp4";
      const ext = originalName.split('.').pop(); 
      const filename = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
      
      let key = (task === "ingest_reference") 
        ? `ideals/${folderName}/videos/${filename}` 
        : `uploads/${folderName}/${filename}`;

      await env.ACE_BUCKET.put(key, request.body);

      return new Response(JSON.stringify({ 
          success: true, 
          key: key, 
          message: "Saved to Storage & Config Updated" 
      }), { headers: corsHeaders });
    }

    // ------------------------------------------------------------------
    // 2. PREDICT ROUTE
    // ------------------------------------------------------------------
    if (request.method === "POST" && url.pathname.endsWith("/predict")) {
      try {
        const body = await request.json();
        
        // Fetch the Latest Config (It might have just been updated!)
        const config = await getSystemConfig();
        const configStr = config ? JSON.stringify(config) : "{}";

        const modelOwner = "n1chj"; 
        const modelName = "ace-athlete-engine";
        const vRes = await fetch(`https://api.replicate.com/v1/models/${modelOwner}/${modelName}/versions`, {
          headers: { "Authorization": `Token ${env.REPLICATE_API_TOKEN}` }
        });
        const vData = await vRes.json();
        const latestVersionId = vData.results[0].id;

        const response = await fetch("https://api.replicate.com/v1/predictions", {
          method: "POST",
          headers: {
            "Authorization": `Token ${env.REPLICATE_API_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            version: latestVersionId,
            webhook: WEBHOOK_URL,
            webhook_events_filter: ["completed"],
            input: {
              video_key: body.videoKey,
              task: body.task,
              exercise_name: body.exerciseName,
              system_config: configStr, 
              r2_endpoint: env.R2_ENDPOINT,
              r2_bucket_name: "ace-athlete-data",
              r2_access_key: env.R2_ACCESS_KEY_ID,
              r2_secret_key: env.R2_SECRET_ACCESS_KEY
            },
          }),
        });

        const data = await response.json();
        return new Response(JSON.stringify(data), { headers: corsHeaders });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    // ------------------------------------------------------------------
    // 3. WEBHOOK ROUTE
    // ------------------------------------------------------------------
    if (request.method === "POST" && url.pathname.endsWith("/webhook")) {
      const prediction = await request.json();
      if (prediction.status !== "succeeded") return new Response("OK", { status: 200 });

      const output = prediction.output;
      const input = prediction.input;
      
      let folderName = "uncategorized";
      try {
          if (input.system_config) {
              const cfg = JSON.parse(input.system_config);
              const sport = input.exercise_name;
              if (cfg[sport] && cfg[sport].folder) folderName = cfg[sport].folder;
          }
      } catch(e) {}

      if (folderName === "uncategorized") {
           folderName = input.exercise_name.trim().replace(/\s+/g, "_");
      }
      
      const timestamp = Date.now();

      if (output.video) {
          const videoRes = await fetch(output.video);
          const videoBlob = await videoRes.arrayBuffer();
          const overlayKey = `overlays/${folderName}/result_${timestamp}.mp4`;
          await env.ACE_BUCKET.put(overlayKey, videoBlob);
      }

      if (output.stats) {
          const statsObj = JSON.parse(output.stats);
          if (statsObj.pkl_b64) {
              const binaryString = atob(statsObj.pkl_b64);
              const len = binaryString.length;
              const bytes = new Uint8Array(len);
              for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
              
              const cleanName = input.exercise_name.trim().replace(/\s+/g, '_');
              const pklKey = `ideals/${folderName}/data/${cleanName}_${timestamp}.pkl`;
              const jsonKey = `ideals/${folderName}/data/${cleanName}_${timestamp}.json`;
              
              await env.ACE_BUCKET.put(pklKey, bytes);
              await env.ACE_BUCKET.put(jsonKey, JSON.stringify(statsObj.meta));
          }
      }
      return new Response("Webhook Processed", { status: 200 });
    }

    // (GET /file and /status routes remain unchanged)
    if (request.method === "GET" && url.pathname.endsWith("/file")) {
      const key = url.searchParams.get("key");
      if (!key) return new Response("Missing Key", { status: 400, headers: corsHeaders });
      const object = await env.ACE_BUCKET.get(key);
      if (!object) return new Response("File Not Found", { status: 404, headers: corsHeaders });
      const headers = new Headers(corsHeaders);
      object.writeHttpMetadata(headers);
      headers.set("etag", object.httpEtag);
      headers.set("Content-Type", "video/mp4"); 
      return new Response(object.body, { headers });
    }

    if (request.method === "GET" && url.pathname.endsWith("/status")) {
      const id = url.searchParams.get("id");
      const r = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
        headers: { "Authorization": `Token ${env.REPLICATE_API_TOKEN}` }
      });
      return new Response(JSON.stringify(await r.json()), { headers: corsHeaders });
    }
    
    return new Response("Not Found", { status: 404, headers: corsHeaders });
  },
};