// backend/src/worker.js

const WEBHOOK_URL = "https://ace-worker.ace-gateway.workers.dev/api/webhook";
const CONFIG_KEY = "system/config.json";
const TIERS_KEY = "system/tiers.json"; 

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
        // LOGGING: Check if secrets exist
        if (!env.GEMINI_API_KEY) {
            console.error("❌ ERROR: GEMINI_API_KEY is missing in secrets!");
            return null;
        }
        if (!env.CLOUDFLARE_ACCOUNT_ID) {
            console.error("❌ ERROR: CLOUDFLARE_ACCOUNT_ID is missing in secrets!");
            return null;
        }

        const gatewayUrl = `https://gateway.ai.cloudflare.com/v1/${env.CLOUDFLARE_ACCOUNT_ID}/ace-gateway/google-ai-studio/v1beta/models/gemini-1.5-flash:generateContent`;
        const tiers_context = await getTiersContext();

        // 1. Granular Data Processing
        const rep_data = stats.reps || [];
        let data_summary = [];
        let total_score = 0;
        let valid_reps = 0;

        for (const rep of rep_data) {
            const score = rep.score !== undefined ? rep.score : 0;
            if (typeof score === 'number') {
                total_score += score;
                valid_reps += 1;
            }

            // Capture specific granular details for the prompt
            data_summary.push({
                "Rep": rep.rep,
                "Score": score,
                "Issues": rep.issues || [], 
                // Flexible: If python sends breakdown later, we capture it.
                "Breakdown": rep.breakdown || {}, 
                "Comparison": rep.match ? `Matched with ${rep.match}` : "No match"
            });
        }

        const avg_score = valid_reps > 0 ? Math.round(total_score / valid_reps) : 0;

        // 2. The Prompt
        const prompt = `You are an elite Fitness Coach. Analyze this user's ${sport} set.
        
        ### PERFORMANCE SNAPSHOT
        **Average Score:** ${avg_score}/100
        **Tiers Context:** ${tiers_context}
        
        ### GRANULAR DATA (Rep by Rep)
        ${JSON.stringify(data_summary)}
        
        ### FEEDBACK GRADIENT (ADJUST YOUR PERSONA)
        
        **IF SCORE < 70 (The Beginner):**
        - Tone: Direct, authoritative, strict.
        - Focus: Identify the ONE biggest safety flaw visible in the 'Issues' list.
        - Output: 3 clear, fundamental corrections.
        
        **IF SCORE 70 - 89 (The Intermediate):**
        - Tone: Supportive coach. "Good job, but let's tighten this up."
        - Focus: Refinement. Connect body parts (e.g. "Your score dropped on Rep 3 because...").
        - Output: 2 specific actionable tips.
        
        **IF SCORE 90+ (The ACE/Elite):**
        - Tone: Peer-to-peer. High praise.
        - Focus: Micro-optimization only.
        - Output: 1 very minor tip or pure validation.
        
        ### OUTPUT FORMAT
        Talk directly to the athlete. No intro fluff.
        Provide the feedback in simple markdown bullet points.
        `;

        try {
            console.log(`🚀 Sending Request to Gateway: ${gatewayUrl}`);
            
            const response = await fetch(gatewayUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-goog-api-key": env.GEMINI_API_KEY
                },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }]
                })
            });

            if (!response.ok) {
                const errText = await response.text();
                console.error(`❌ Gateway Error (${response.status}):`, errText);
                return null;
            }

            const data = await response.json();
            const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
            
            if (text) {
                console.log("✅ Gemini Response Received!");
                return text;
            } else {
                console.error("❌ Gemini response format was empty/unexpected:", JSON.stringify(data));
                return null;
            }

        } catch (e) {
            console.error("❌ EXCEPTION in getCoachingTips:", e);
            return null;
        }
    }

    // ------------------------------------------------------------------
    // NEW ROUTE: GET /feedback?id={replicate_id}
    // ------------------------------------------------------------------
    if (request.method === "GET" && url.pathname.endsWith("/feedback")) {
        const id = url.searchParams.get("id");
        if (!id) return new Response("Missing ID", { status: 400, headers: corsHeaders });
        
        // Try to fetch the feedback file saved by the webhook
        const key = `feedback/${id}.json`;
        const object = await env.ACE_BUCKET.get(key);
        
        if (!object) {
            return new Response(JSON.stringify({ status: "pending" }), { headers: corsHeaders });
        }
        
        const data = await object.json();
        return new Response(JSON.stringify(data), { headers: corsHeaders });
    }

    // ------------------------------------------------------------------
    // EXISTING ROUTES (Config, Upload, Predict, File, Status)
    // ------------------------------------------------------------------
    if (request.method === "GET" && url.pathname.endsWith("/config")) {
        const config = await getSystemConfig();
        return new Response(JSON.stringify(config), { headers: corsHeaders });
    }

    if (request.method === "PUT" && url.pathname.endsWith("/upload")) {
      const task = url.searchParams.get("task");
      const sportName = url.searchParams.get("sport"); 
      let config = await getSystemConfig();
      let folderName = "uncategorized";

      if (config && config[sportName]) {
          folderName = config[sportName].folder;
      } else {
          folderName = sportName.trim().replace(/\s+/g, "_");
          const newEntry = { "folder": folderName, "rotation": "None", "rep_settings": {}, "dtw_settings": {}, "safety_checks": [] };
          config[sportName] = newEntry;
          await saveSystemConfig(config);
      }
      
      const originalName = request.headers.get("X-File-Name") || "video.mp4";
      const ext = originalName.split('.').pop(); 
      const filename = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
      let key = (task === "ingest_reference") ? `ideals/${folderName}/videos/${filename}` : `uploads/${folderName}/${filename}`;
      await env.ACE_BUCKET.put(key, request.body);

      return new Response(JSON.stringify({ success: true, key: key, message: "Saved" }), { headers: corsHeaders });
    }

    if (request.method === "POST" && url.pathname.endsWith("/predict")) {
      try {
        const body = await request.json();
        const config = await getSystemConfig();
        const configStr = config ? JSON.stringify(config) : "{}";
        const modelOwner = "n1chj"; const modelName = "ace-athlete-engine";
        const vRes = await fetch(`https://api.replicate.com/v1/models/${modelOwner}/${modelName}/versions`, { headers: { "Authorization": `Token ${env.REPLICATE_API_TOKEN}` } });
        const latestVersionId = (await vRes.json()).results[0].id;

        const response = await fetch("https://api.replicate.com/v1/predictions", {
          method: "POST",
          headers: { "Authorization": `Token ${env.REPLICATE_API_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            version: latestVersionId, webhook: WEBHOOK_URL, webhook_events_filter: ["completed"],
            input: {
              video_key: body.videoKey, task: body.task, exercise_name: body.exerciseName, system_config: configStr, 
              r2_endpoint: env.R2_ENDPOINT, r2_bucket_name: "ace-athlete-data", r2_access_key: env.R2_ACCESS_KEY_ID, r2_secret_key: env.R2_SECRET_ACCESS_KEY
            },
          }),
        });
        return new Response(JSON.stringify(await response.json()), { headers: corsHeaders });
      } catch (err) { return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders }); }
    }

    if (request.method === "POST" && url.pathname.endsWith("/webhook")) {
      const prediction = await request.json();
      if (prediction.status !== "succeeded") return new Response("OK", { status: 200 });

      const output = prediction.output;
      const input = prediction.input;
      let folderName = input.exercise_name.trim().replace(/\s+/g, "_");
      try {
          if (input.system_config) {
              const cfg = JSON.parse(input.system_config);
              if (cfg[input.exercise_name]?.folder) folderName = cfg[input.exercise_name].folder;
          }
      } catch(e) {}
      
      const timestamp = Date.now();

      if (output.video) {
          const videoRes = await fetch(output.video);
          await env.ACE_BUCKET.put(`overlays/${folderName}/result_${timestamp}.mp4`, await videoRes.arrayBuffer());
      }

      if (output.stats) {
          const statsObj = JSON.parse(output.stats);
          
          if (statsObj.pkl_b64) {
              const cleanName = input.exercise_name.trim().replace(/\s+/g, '_');
              const bytes = Uint8Array.from(atob(statsObj.pkl_b64), c => c.charCodeAt(0));
              await env.ACE_BUCKET.put(`ideals/${folderName}/data/${cleanName}_${timestamp}.pkl`, bytes);
              await env.ACE_BUCKET.put(`ideals/${folderName}/data/${cleanName}_${timestamp}.json`, JSON.stringify(statsObj.meta));
          }

          if (input.task === 'analyze') {
               const coachingAdvice = await getCoachingTips(input.exercise_name, { reps: statsObj.reps }, env);
               
               if (coachingAdvice) {
                   // KEY CHANGE: Save using the Replicate ID so frontend can find it!
                   // prediction.id comes from the webhook payload
                   const feedbackKey = `feedback/${prediction.id}.json`;
                   await env.ACE_BUCKET.put(feedbackKey, JSON.stringify({
                       advice: coachingAdvice,
                       generated_at: new Date().toISOString()
                   }));
               }
          }
      }
      return new Response("Webhook Processed", { status: 200 });
    }

    if (request.method === "GET" && url.pathname.endsWith("/file")) {
      const key = url.searchParams.get("key");
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
      const r = await fetch(`https://api.replicate.com/v1/predictions/${id}`, { headers: { "Authorization": `Token ${env.REPLICATE_API_TOKEN}` } });
      return new Response(JSON.stringify(await r.json()), { headers: corsHeaders });
    }
    
    return new Response("Not Found", { status: 404, headers: corsHeaders });
  },
};