// src/worker.js
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. CORS Headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // 2. ROUTE: /api/predict
    if (request.method === "POST" && (url.pathname === "/api/predict" || url.pathname === "/predict")) {
      try {
        const body = await request.json();

        // --- NEW STEP: Fetch the latest version ID dynamically ---
        // Replace 'your-username' with your actual Replicate username
        const modelOwner = "n1chj"; 
        const modelName = "ace-athlete-engine";
        
        const versionResponse = await fetch(`https://api.replicate.com/v1/models/${modelOwner}/${modelName}/versions`, {
          method: "GET",
          headers: {
            "Authorization": `Token ${env.REPLICATE_API_TOKEN}`,
          },
        });

        if (!versionResponse.ok) {
           throw new Error("Failed to fetch model version");
        }

        const versionsData = await versionResponse.json();
        // The API returns a list, the first one is the latest
        const latestVersionId = versionsData.results[0].id;
        // ---------------------------------------------------------

        // Now run prediction using that dynamic ID
        const response = await fetch("https://api.replicate.com/v1/predictions", {
          method: "POST",
          headers: {
            "Authorization": `Token ${env.REPLICATE_API_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            version: latestVersionId, // <--- No more hardcoding!
            input: {
              video: body.videoUrl,
              task: body.task || "analyze",
              exercise_name: body.exerciseName || "squat",
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

    // 3. ROUTE: /api/status
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