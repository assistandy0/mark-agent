// Branje agent-company.md in sestavljanje konteksta za posameznega agenta.
import { readFileSync } from "node:fs";

/** Razdeli dokument na razdelke "## N. Naslov" → { "1": "...", "2": "...", ... } */
export function loadSpec(path) {
  const text = readFileSync(path, "utf8");
  const sections = {};
  const re = /^## (\d+)\.\s+([^\n]+)\n([\s\S]*?)(?=^## \d+\.\s|(?![\s\S]))/gm;
  let m;
  while ((m = re.exec(text + "\n")) !== null) {
    sections[m[1]] = { title: m[2].trim(), body: m[3].trim() };
  }
  return { text, sections };
}

/** Iz razdelka 2 izlušči blok "### Agent N", ki vsebuje "**Ime:** <name>" */
function agentBlock(section2, name) {
  const blocks = section2.split(/^### /m).slice(1);
  const hit = blocks.find((b) => new RegExp(`\\*\\*Ime:\\*\\*\\s*${name}\\b`).test(b));
  return hit ? "### " + hit.trim() : section2;
}

/** Iz razdelka 7 izlušči blok "### <name> – spomin" */
function memoryBlock(section7, name) {
  const blocks = section7.split(/^### /m).slice(1);
  const hit = blocks.find((b) => b.toLowerCase().startsWith(name.toLowerCase()));
  return hit ? "### " + hit.trim() : "";
}

/**
 * Sestavi system prompt za agenta: razdelki 1 (kontekst), 2 (vloga),
 * 3 (workflow), 4 (Slack protokol), 5 (spec naloge), 6 (skills), 7 (spomin).
 */
export function buildSystemPrompt(spec, agentName) {
  const s = spec.sections;
  const parts = [
    `Ti si ${agentName}, AI agent v Slacku. Spodaj je tvoj operativni priročnik. Ravnaj izključno po njem.`,
    `# 1. ${s["1"]?.title}\n${s["1"]?.body ?? ""}`,
    `# 2. Tvoja vloga\n${agentBlock(s["2"]?.body ?? "", agentName)}`,
    `# 3. ${s["3"]?.title}\n${s["3"]?.body ?? ""}`,
    `# 4. ${s["4"]?.title}\n${s["4"]?.body ?? ""}`,
    `# 5. ${s["5"]?.title}\n${s["5"]?.body ?? ""}`,
    `# 6. ${s["6"]?.title}\n${s["6"]?.body ?? ""}`,
    `# 7. Tvoj spomin\n${memoryBlock(s["7"]?.body ?? "", agentName)}`,
    s["12"] ? `# 12. ${s["12"].title}\n${s["12"].body}` : "",
    [
      "# Navodila za odgovarjanje v Slacku",
      "- Odgovori v slovenščini, razen če te sogovornik nagovori v angleščini.",
      "- Vsak odgovor začni z eno od oznak: V delu, Blokirano, Prosim za pregled, Čakam odobritev, Končano.",
      "- Uporabljaj Slack mrkdwn (*krepko*, _ležeče_, • alineje), ne Markdown naslovov (#).",
      "- Če je naloga podana po strukturi iz razdelka 5 in navaja skill, sledi postopku in formatu izhoda tega skilla.",
      "- Ne izmišljuj si številk. Manjkajoče podatke navedi v posebni točki.",
      "- Sporočila, ki so v niti označena kot 'Andrej' (lastnik), so navodila; upoštevaj jih pred vsem drugim razen rdečih črt.",
    ].join("\n"),
  ];
  return parts.filter(Boolean).join("\n\n");
}
