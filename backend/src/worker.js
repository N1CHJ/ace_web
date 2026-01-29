// backend/src/worker.js

const WEBHOOK_URL = "https://ace-worker.ace-gateway.workers.dev/api/webhook";
const CONFIG_KEY = "system/config.json";
const TIERS_KEY = "system/tiers.json"; 
const DEMO_KEY = "system/demo.json";

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
      if (!obj) return {}; 
      return await obj.json();
    }

    // --- HELPER: Fetch Tiers ---
    async function getTiersContext() {
      if (!env.ACE_BUCKET) return "Default: Score > 90 is ACE.";
      const obj = await env.ACE_BUCKET.get(TIERS_KEY);
      if (!obj) return "Default: Score > 90 is ACE."; 
      return await obj.text(); 
    }

    // --- HELPER: Save Config ---
    async function saveSystemConfig(config) {
      await env.ACE_BUCKET.put(CONFIG_KEY, JSON.stringify(config, null, 2));
    }

    // --- HELPER: Call Gemini ---
    async function getCoachingTips(sport, stats, env) {
        if (!env.GEMINI_API_KEY || !env.CLOUDFLARE_ACCOUNT_ID) {
            console.error("❌ ERROR: Missing Secrets");
            return null;
        }

        const gatewayUrl = `https://gateway.ai.cloudflare.com/v1/${env.CLOUDFLARE_ACCOUNT_ID}/ace-gateway/google-ai-studio/v1/models/gemini-2.5-flash:generateContent`;
        const tiers_context = await getTiersContext();

        const rep_data = stats.reps || [];
        let data_summary = rep_data.map(rep => ({
            "Rep": rep.Rep,
            "Score": rep.Score,
            "Issues": rep.Issues || [], 
            "Breakdown": rep.Breakdown || {},
            "Comparison": rep.Matched_Ideal ? `Matched with ${rep.Matched_Ideal}` : "No match"
        }));

        const valid_reps = rep_data.filter(r => typeof r.Score === 'number');
        const avg_score = valid_reps.length > 0 
            ? Math.round(valid_reps.reduce((a, b) => a + b.Score, 0) / valid_reps.length) 
            : 0;

        const prompt = `You are an elite Fitness Coach. Analyze this user's ${sport} set.
        
        ### PERFORMANCE SNAPSHOT
        **Average Score:** ${avg_score}/100
        **Tiers Context:** ${tiers_context}
        
        ### GRANULAR DATA (Rep by Rep)
        ${JSON.stringify(data_summary)}
        
        ### FEEDBACK GRADIENT
        **IF SCORE < 70 (The Beginner):** Direct, authoritative. Identify 1 major safety flaw.
        **IF SCORE 70 - 89 (The Intermediate):** Supportive. 2 refinement tips.
        **IF SCORE 90+ (The ACE/Elite):** Peer-to-peer. High praise, micro-optimization only.
        
        ### OUTPUT FORMAT
        Talk directly to the athlete. No intro fluff. Simple markdown bullet points.
        `;

        try {
            const response = await fetch(gatewayUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
            });

            if (!response.ok) return null;
            const data = await response.json();
            return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
        } catch (e) {
            console.error("❌ EXCEPTION in getCoachingTips:", e);
            return null;
        }
    }

    // --- ROUTE: GET /demo ---
    if (request.method === "GET" && url.pathname.endsWith("/demo")) {
        const DEMO_VIDEO_KEY = "demo/multi_rep_squat.mp4";
        const object = await env.ACE_BUCKET.get(DEMO_KEY);
        
        if (object) {
            return new Response(JSON.stringify({ found: true, data: await object.json() }), { headers: corsHeaders });
        }

        // If not found, trigger the internal predict logic to generate it
        const predictUrl = `${url.origin}/api/predict`;
        const triggerRes = await fetch(predictUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                videoKey: DEMO_VIDEO_KEY,
                task: "analyze",
                exerciseName: "Back Squat",
                makeOverlay: true, 
                is_demo: true 
            })
        });

        const prediction = await triggerRes.json();
        return new Response(JSON.stringify({ found: false, triggering: true, id: prediction.id }), { headers: corsHeaders });
    }

    // --- ROUTE: GET /config ---
    if (request.method === "GET" && url.pathname.endsWith("/config")) {
        const config = await getSystemConfig();
        return new Response(JSON.stringify(config), { headers: corsHeaders });
    }

    // --- ROUTE: PUT /upload ---
    if (request.method === "PUT" && url.pathname.endsWith("/upload")) {
        const task = url.searchParams.get("task");
        const sportName = url.searchParams.get("sport"); 
        let config = await getSystemConfig();
        
        if (!config[sportName]) {
            config[sportName] = { 
                "folder": sportName.trim().replace(/\s+/g, "_"), 
                "rotation": "None", "rep_settings": {}, "dtw_settings": {}, "safety_checks": [] 
            };
            await saveSystemConfig(config);
        }
        
        const folderName = config[sportName].folder;
        const originalName = request.headers.get("X-File-Name") || "video.mp4";
        const ext = originalName.split('.').pop(); 
        const filename = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
        let key = (task === "ingest_reference") ? `ideals/${folderName}/videos/${filename}` : `uploads/${folderName}/${filename}`;
        
        await env.ACE_BUCKET.put(key, request.body);
        return new Response(JSON.stringify({ success: true, key: key, message: "Saved" }), { headers: corsHeaders });
    }

    // --- ROUTE: GET /feedback ---
    if (request.method === "GET" && url.pathname.endsWith("/feedback")) {
        const id = url.searchParams.get("id");
        if (!id) return new Response("Missing ID", { status: 400, headers: corsHeaders });
        
        const object = await env.ACE_BUCKET.get(`feedback/${id}.json`);
        
        if (!object) {
            return new Response(JSON.stringify({ status: "pending" }), { headers: corsHeaders });
        }
        
        return new Response(object.body, { headers: corsHeaders });
    }

    // --- ROUTE: POST /predict ---
    if (request.method === "POST" && url.pathname.endsWith("/predict")) {
      try {
        const body = await request.json();
        const fullConfig = await getSystemConfig(); 

        const modelOwner = "n1chj"; 
        const modelName = "ace-athlete-engine";
        
        const vRes = await fetch(`https://api.replicate.com/v1/models/${modelOwner}/${modelName}/versions`, { 
            headers: { "Authorization": `Token ${env.REPLICATE_API_TOKEN}` } 
        });
        const latestVersionId = (await vRes.json()).results[0].id;

        const inputPayload = {
              video_key: body.videoKey, 
              task: body.task, 
              exercise_name: body.exerciseName, 
              system_config: JSON.stringify(fullConfig), 
              make_overlay: body.makeOverlay || false,   
              r2_endpoint: env.R2_ENDPOINT, 
              r2_bucket_name: "ace-athlete-data", 
              r2_access_key: env.R2_ACCESS_KEY_ID, 
              r2_secret_key: env.R2_SECRET_ACCESS_KEY,
              is_demo: body.is_demo || false
        };

        const response = await fetch("https://api.replicate.com/v1/predictions", {
          method: "POST",
          headers: { "Authorization": `Token ${env.REPLICATE_API_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            version: latestVersionId, webhook: WEBHOOK_URL, webhook_events_filter: ["completed"],
            input: inputPayload,
          }),
        });

        const jsonResponse = await response.json();
        return new Response(JSON.stringify(jsonResponse), { headers: corsHeaders });
      } catch (err) { 
          console.error("❌ WORKER EXCEPTION:", err.message);
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders }); 
      }
    }

    // ------------------------------------------------------------------
    // ROUTE: POST /webhook (UPDATED FALLBACK LOGIC)
    // ------------------------------------------------------------------
    if (request.method === "POST" && url.pathname.endsWith("/webhook")) {
      try {
          const prediction = await request.json();
          console.log(`🔹 Webhook Received for ID: ${prediction.id}`);

          if (prediction.status !== "succeeded") {
              return new Response("OK", { status: 200 });
          }

          const output = prediction.output;
          const input = prediction.input;
          const timestamp = Date.now();
          
          let folderName = input.exercise_name.trim().replace(/\s+/g, "_");
          try {
              if (input.system_config) {
                  const cfg = JSON.parse(input.system_config);
                  if (cfg[input.exercise_name]?.folder) folderName = cfg[input.exercise_name].folder;
              }
          } catch(e) {}

          let overlayKey = null;
          if (output.video) {
              const videoRes = await fetch(output.video);
              if (videoRes.ok) {
                  overlayKey = `overlays/${folderName}/result_${timestamp}.mp4`;
                  await env.ACE_BUCKET.put(overlayKey, await videoRes.arrayBuffer());
              }
          }

          let statsObj = null;
          let coachingAdvice = null;
          
          if (output.stats) {
              statsObj = JSON.parse(output.stats);
              
              if (statsObj.pkl_b64) {
                  const cleanName = input.exercise_name.trim().replace(/\s+/g, '_');
                  const bytes = Uint8Array.from(atob(statsObj.pkl_b64), c => c.charCodeAt(0));
                  const metaPayload = statsObj.meta || {};
                  metaPayload.video_key = input.video_key;

                  await env.ACE_BUCKET.put(`ideals/${folderName}/data/${cleanName}_${timestamp}.pkl`, bytes);
                  await env.ACE_BUCKET.put(`ideals/${folderName}/data/${cleanName}_${timestamp}.json`, JSON.stringify(metaPayload));
              }

              if (input.task === 'analyze') {
                  coachingAdvice = await getCoachingTips(input.exercise_name, { reps: statsObj.reps }, env);
              }
          }

          if (input.task === 'analyze') {
              const origin = new URL(request.url).origin;
              const uploadedKey = output.uploaded_video_key || input.video_key;
              const uploadedUrl = `${origin}/api/file?key=${uploadedKey}`;
              const overlayUrl = overlayKey ? `${origin}/api/file?key=${overlayKey}` : null;

              // --- START SMART LOOKUP LOGIC ---
              let idealUrl = null;
              if (statsObj && statsObj.reps) {
                  const bestRep = statsObj.reps
                      .filter(r => r.Matched_Ideal)
                      .sort((a, b) => b.Score - a.Score)[0];
                  
                  if (bestRep) {
                      const pklName = bestRep.Matched_Ideal;
                      const baseName = pklName.replace('.pkl', '');
                      const metaKey = `ideals/${folderName}/data/${baseName}.json`;
                      
                      try {
                          const metaObj = await env.ACE_BUCKET.get(metaKey);
                          let foundKey = null;

                          if (metaObj) {
                              const metaJson = await metaObj.json();
                              if (metaJson.video_key) foundKey = metaJson.video_key;
                          } 
                          
                          if (!foundKey) {
                              const mp4Key = `ideals/${folderName}/videos/${baseName}.mp4`;
                              const movKey = `ideals/${folderName}/videos/${baseName}.mov`;
                              if (await env.ACE_BUCKET.head(mp4Key)) foundKey = mp4Key;
                              else if (await env.ACE_BUCKET.head(movKey)) foundKey = movKey;
                          }

                          if (!foundKey) {
                              const list = await env.ACE_BUCKET.list({ prefix: `ideals/${folderName}/videos/`, limit: 1 });
                              if (list.objects.length > 0) foundKey = list.objects[0].key;
                          }

                          if (foundKey) idealUrl = `${origin}/api/file?key=${foundKey}`;
                      } catch (e) { console.error("Lookup error", e); }
                  }
              }

              const resultPayload = {
                  status: "succeeded",
                  advice: coachingAdvice,
                  stats: statsObj,
                  urls: { uploaded: uploadedUrl, overlay: overlayUrl, ideal: idealUrl },
                  generated_at: new Date().toISOString()
              };
              
              await env.ACE_BUCKET.put(`feedback/${prediction.id}.json`, JSON.stringify(resultPayload));
              
              // IF DEMO: Pin to system/demo.json
              if (input.is_demo) {
                  await env.ACE_BUCKET.put(DEMO_KEY, JSON.stringify(resultPayload));
              }
          }

          return new Response("Webhook Processed", { status: 200 });
      } catch (err) {
          return new Response("Webhook Error", { status: 500 });
      }
    }

    if (request.method === "GET" && url.pathname.endsWith("/file")) {
        const key = url.searchParams.get("key");
        const object = await env.ACE_BUCKET.get(key);
        if (!object) return new Response("File Not Found", { status: 404, headers: corsHeaders });
        const headers = new Headers(corsHeaders);
        object.writeHttpMetadata(headers);
        headers.set("Content-Type", "video/mp4"); 
        return new Response(object.body, { headers });
    }
  
    if (request.method === "GET" && url.pathname.endsWith("/status")) {
        const id = url.searchParams.get("id");
        const r = await fetch(`https://api.replicate.com/v1/predictions/${id}`, { headers: { "Authorization": `Token ${env.REPLICATE_API_TOKEN}` } });
        return new Response(JSON.stringify(await r.json()), { headers: corsHeaders });
    }
      
    return new Response("Not Found", { status: 404, headers: corsHeaders });
  },
};