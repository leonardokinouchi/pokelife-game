const frame = document.getElementById("practiceGame");
const status = document.getElementById("practiceStatus");
const buttons = [...document.querySelectorAll("[data-game]")];

for (const button of buttons) {
  button.addEventListener("click", async () => {
    buttons.forEach(choice => { choice.disabled = true; });
    status.hidden = false;
    status.textContent = "Preparando partida…";
    try {
      const response = await fetch("/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "practice", kind: button.dataset.game }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      sessionStorage.setItem("auroraPractice", JSON.stringify({ code: result.code, token: result.token }));
      frame.src = "/test-minigames/play";
      frame.hidden = false;
      status.hidden = true;
      for (const choice of buttons)
        choice.setAttribute("aria-pressed", String(choice === button));
    } catch (error) {
      status.textContent = error.message;
    } finally {
      buttons.forEach(choice => { choice.disabled = false; });
    }
  });
}
