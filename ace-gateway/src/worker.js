// src/worker.js

const WEBHOOK_URL = "https://ace-gateway.ace-gateway.workers.dev/api/webhook";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS Headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-File-Name",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // 1. UPLOAD ROUTE (User -> R2 Raw)
    if (request.method === "PUT" && url.pathname.endsWith("/upload")) {
      if (!env.ACE_BUCKET) return new Response("No Bucket", { status: 500 });
      
      const rawSport = url.searchParams.get("sport") || "uncategorized";
      const sport = rawSport.toLowerCase().replace(/[^a-z0-9]/g, "_");
      const filename = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}.mp4`;
      const key = `uploads/${sport}/${filename}`; // RAW VIDEO FOLDER

      await env.ACE_BUCKET.put(key, request.body);

      return new Response(JSON.stringify({ success: true, key: key }), { headers: corsHeaders });
    }

    // 2. PREDICT ROUTE (Gateway -> Replicate)
    if (request.method === "POST" && url.pathname.endsWith("/predict")) {
      try {
        const body = await request.json();
        
        // Fetch Version (Simplified for brevity, keep your dynamic fetch code here)
        const version = "YOUR_LATEST_HASH_OR_DYNAMIC_FETCH_CODE"; 
        // Note: Use your dynamic fetch logic from before, I'm simplifying for the example

        const response = await fetch("https://api.replicate.com/v1/predictions", {
          method: "POST",
          headers: {
            "Authorization": `Token ${env.REPLICATE_API_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            version: version, // Ensure this is set!
            
            // WEBHOOK CONFIGURATION
            webhook: WEBHOOK_URL,
            webhook_events_filter: ["completed"], // Only call us when done

            input: {
              video_key: body.videoKey,
              task: body.task || "analyze",
              exercise_name: body.exerciseName,
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

    // 3. WEBHOOK ROUTE (Replicate -> R2 Result)
    // This is the "Second Worker" logic you asked for!
    if (request.method === "POST" && url.pathname.endsWith("/webhook")) {
      try {
        const prediction = await request.json();
        
        if (prediction.status !== "succeeded") {
            return new Response("Not succeeded", { status: 200 });
        }

        const output = prediction.output; // { video: "url", stats: "string_json" }
        const input = prediction.input;
        const sport = input.exercise_name.split('_')[0].toLowerCase();
        const timestamp = Date.now();

        // A. Handle VIDEO Result (Overlay)
        if (output.video) {
            console.log("Downloading Result Video...");
            const videoRes = await fetch(output.video);
            const videoBlob = await videoRes.arrayBuffer();
            
            // SAVE TO OVERLAYS
            const overlayKey = `overlays/${sport}/result_${timestamp}.mp4`;
            await env.ACE_BUCKET.put(overlayKey, videoBlob);
            console.log("Saved Overlay:", overlayKey);
        }

        // B. Handle INGEST Result (PKL + Meta)
        if (output.stats) {
            const statsObj = JSON.parse(output.stats);
            
            // Check if this was an Ingest task (has pkl_b64)
            if (statsObj.pkl_b64) {
                console.log("Saving Ingest Data...");
                
                // 1. Save PKL (Decode Base64)
                // We need to decode the base64 string back to binary
                const binaryString = atob(statsObj.pkl_b64);
                const len = binaryString.length;
                const bytes = new Uint8Array(len);
                for (let i = 0; i < len; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                
                const pklKey = `ideals/${sport}/${input.exercise_name}_${timestamp}.pkl`;
                await env.ACE_BUCKET.put(pklKey, bytes);

                // 2. Save JSON Metadata
                const jsonKey = `ideals/${sport}/${input.exercise_name}_${timestamp}.json`;
                await env.ACE_BUCKET.put(jsonKey, JSON.stringify(statsObj.meta));
                
                console.log("Saved Ideal:", pklKey);
            }
        }

        return new Response("Webhook Processed", { status: 200 });

      } catch (err) {
        console.error("Webhook Error:", err);
        return new Response("Webhook Error", { status: 500 });
      }
    }
    
    // Status polling route (unchanged)
    if (request.method === "GET" && url.pathname.endsWith("/status")) {
        // ... (keep your existing status code) ...
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  },
};