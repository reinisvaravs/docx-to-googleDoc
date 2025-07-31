async function main() {
  try {
    const result = await fetch("http://localhost:8383/n8n/identify-file-type", {
      headers: {
        "x-api-key": "DEV_1233219876",
        "Content-Type": "application/json",
      },
      method: "POST",
      body: JSON.stringify({
        url: "https://www.google.com",
      }),
    });
    console.log(await result.json());
  } catch (error) {
    console.log(error);
  }
}

main();
