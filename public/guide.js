const percent = new Intl.NumberFormat("pt-BR", { style:"percent", maximumFractionDigits:3 });
const encounterForm = document.getElementById("encounterForm");
const captureForm = document.getElementById("captureForm");
const encounterSearch = document.getElementById("encounterSearch");
const speciesSelect = captureForm.elements.namedItem("id");
const encounterStatus = document.getElementById("encounterStatus");
const captureStatus = document.getElementById("captureStatus");
const encountersBody = document.getElementById("encountersBody");
const captureResults = document.getElementById("captureResults");
const balls = {"poke-ball":"Poké Bola","great-ball":"Grande Bola","ultra-ball":"Ultra Bola","master-ball":"Master Ball"};
const normalize = value => value.normalize("NFD").replace(/\p{Diacritic}/gu,"").toLowerCase();
let encounters = [], encounterRequest = 0, captureRequest = 0, species = new Map();

async function guideData(route, params) {
  const response = await fetch("/api/guide/" + route + (params ? "?" + params : ""));
  const data = await response.json();
  if (!response.ok) throw Error(data.error || "Não foi possível consultar o guia.");
  return data;
}

function renderEncounters() {
  const search = normalize(encounterSearch.value.trim());
  const filtered = encounters.filter(mon => normalize(mon.name).includes(search));
  encountersBody.replaceChildren(...filtered.map(mon => {
    const row = document.createElement("tr");
    const name = document.createElement("button");
    name.type = "button";
    name.textContent = mon.name;
    name.dataset.species = mon.id;
    row.insertCell().append(name);
    for (const value of [mon.common, mon.themed, mon.common + mon.themed])
      row.insertCell().textContent = value ? percent.format(value) : "—";
    return row;
  }));
  encounterStatus.textContent = filtered.length + " resultados";
}

async function loadEncounters() {
  const request = ++encounterRequest;
  encounterStatus.textContent = "Consultando encontros…";
  try {
    const data = await guideData("encounters", new URLSearchParams(new FormData(encounterForm)));
    if (request !== encounterRequest) return;
    encounters = data;
    renderEncounters();
  } catch (error) {
    if (request !== encounterRequest) return;
    encounters = [];
    encountersBody.replaceChildren();
    encounterStatus.textContent = error.message;
  }
}

async function calculateCapture() {
  const request = ++captureRequest;
  captureResults.replaceChildren();
  if (!captureForm.reportValidity()) return;
  captureStatus.textContent = "Calculando…";
  const params = new URLSearchParams(new FormData(captureForm));
  try {
    const data = await guideData("capture", params);
    if (request !== captureRequest) return;
    captureStatus.textContent = "Taxa base da espécie: " + species.get(params.get("id"))?.rate + "/255.";
    for (const [id, value] of Object.entries(data)) {
      const card = document.createElement("div"), label = document.createElement("dt"), result = document.createElement("dd");
      label.textContent = balls[id];
      result.textContent = percent.format(value);
      card.append(label, result);
      captureResults.append(card);
    }
  } catch (error) {
    if (request === captureRequest) captureStatus.textContent = error.message;
  }
}

encounterForm.addEventListener("submit", event => { event.preventDefault(); loadEncounters(); });
encounterSearch.addEventListener("input", renderEncounters);
captureForm.addEventListener("submit", event => { event.preventDefault(); calculateCapture(); });
encountersBody.addEventListener("click", event => {
  const id = event.target.closest("[data-species]")?.dataset.species;
  if (!species.has(id)) return;
  speciesSelect.value = id;
  document.getElementById("captura").scrollIntoView();
  speciesSelect.focus({preventScroll:true});
  calculateCapture();
});
loadEncounters();
guideData("species").then(data => {
  species = new Map(data.map(mon => [String(mon.id), mon]));
  speciesSelect.replaceChildren(...data.map(mon => new Option(mon.name, mon.id)));
  speciesSelect.value = "16";
  calculateCapture();
}).catch(error => { captureStatus.textContent = error.message; });
