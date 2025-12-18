// src/worker.js
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. CORS Headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS", // Added PUT
      "Access-Control-Allow-Headers": "Content-Type, X-File-Name", // Added custom headers if needed
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // ---------------------------------------------------------
    // NEW ROUTE: /api/upload (Direct to R2)
    // ---------------------------------------------------------
    if (request.method === "PUT" && (url.pathname === "/api/upload" || url.pathname === "/upload")) {
      try {
        // 1. Check Binding
        if (!env.ACE_BUCKET) {
          throw new Error("R2 Bucket not bound. Check wrangler.toml [[r2_buckets]].");
        }

        // 2. Generate Key (Path)
        // Expecting url params like ?sport=squat
        const sport = url.searchParams.get("sport") || "uncategorized";
        const timestamp = Date.now();
        // Generate a short random string to prevent collisions
        const randomId = Math.random().toString(36).substring(2, 8);
        const filename = `${timestamp}_${randomId}.mp4`;
        
        const key = `raw/${sport}/${filename}`;

        // 3. Upload to R2
        // request.body is the binary stream of the video
        await env.ACE_BUCKET.put(key, request.body);

        // 4. Return the Key
        // Note: We return the 'key' so the frontend can pass it to Replicate
        return new Response(JSON.stringify({ 
          success: true,
          key: key, 
          message: "Upload successful" 
        }), { headers: corsHeaders });

      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    // ---------------------------------------------------------
    // ROUTE: /api/predict
    // ---------------------------------------------------------
    if (request.method === "POST" && (url.pathname === "/api/predict" || url.pathname === "/predict")) {
      try {
        const body = await request.json();

        // 1. Fetch Latest Version ID
        const modelOwner = "n1chj"; 
        const modelName = "ace-athlete-engine";
        
        const versionResponse = await fetch(`https://api.replicate.com/v1/models/${modelOwner}/${modelName}/versions`, {
          method: "GET",
          headers: {
            "Authorization": `Token ${env.REPLICATE_API_TOKEN}`,
          },
        });

        if (!versionResponse.ok) throw new Error("Failed to fetch model version");
        
        const versionsData = await versionResponse.json();
        const latestVersionId = versionsData.results[0].id;

        // 2. Trigger Replicate
        const response = await fetch("https://api.replicate.com/v1/predictions", {
          method: "POST",
          headers: {
            "Authorization": `Token ${env.REPLICATE_API_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            version: latestVersionId,
            input: {
              // Now we can pass the 'key' if we update predict.py, 
              // or the videoUrl if still using public URLs.
              video: body.videoUrl, 
              // We pass the key as a separate input for our new 'smart' predict.py
              video_key: body.videoKey || null, 
              
              task: body.task || "analyze",
              exercise_name: body.exerciseName || "squat",
              
              // Pass R2 Credentials so Replicate can download the private file using the key
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

    // ---------------------------------------------------------
    // ROUTE: /api/status
    // ---------------------------------------------------------
    if (request.method === "GET" && (url.pathname === "/api/status" || url.pathname === "/status")) {
      const id = url.searchParams.get("id");
      const response = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
        headers: { "Authorization": `Token ${env.REPLICATE_API_TOKEN}` },
      });
      const data = await response.json();
      return new Response(JSON.stringify(data), { headers: corsHeaders });
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  },
};