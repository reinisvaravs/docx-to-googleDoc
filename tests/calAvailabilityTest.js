import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

export async function calAvailabilityTest() {
  try {
    const response = await fetch(
      `${
        process.env.DEV ? process.env.DEV_URL : process.env.PROD_URL
      }/n8n/calendar-availability`,
      {
        method: "POST",
        headers: {
          "x-api-key": process.env.API_SECRET,
          "Content-Type": "application/json",
        },
      }
    );

    const contentType = response.headers.get("content-type");
    if (
      response.ok &&
      contentType &&
      contentType.includes("application/json")
    ) {
      const result = await response.json();
      console.log("Success:", result);
    } else {
      const text = await response.text();
      console.error(`Error ${response.status}:`, text);
    }
  } catch (err) {
    console.error("Network or fetch error:", err);
  }
}

calAvailabilityTest();
