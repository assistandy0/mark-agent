# mark-agent

Backend za Slack agente, ki jih opisuje `agent-company.md` (Pripravi.si). Prvi agent: **Mark** (marketing).

Kaj dela: Slack pošlje dogodek (`app_mention` ali DM) → Bolt preveri podpis s signing secretom → backend prebere `agent-company.md`, sestavi system prompt (kontekst, vloga, workflow, Slack protokol, skills, spomin) + zgodovino niti → Anthropic API → odgovor v isto nit.

`agent-company.md` se bere ob **vsaki** nalogi, zato sprememba v datoteki velja takoj (brez restarta).

## Lokalni test (opcijsko)

```bash
npm install
cp .env.example .env     # vpiši vrednosti
npm start                # http://localhost:3000/health (lokalno PORT=3000)
```

## Namestitev na VPS (Docker)

```bash
git clone <repo> ~/mark-agent && cd ~/mark-agent
cp .env.example .env && nano .env          # vpiši token, signing secret, API ključ
docker compose up -d --build
docker compose logs -f                      # pričakuj: "Agent Mark: /slack/mark/events"
curl -s localhost:3020/health
```

Kontejner posluša na `127.0.0.1:3020` (3000 zaseda OpenClaw).

### DNS (Cloudflare)
A-zapis `mark` → javni IP VPS-a, **Proxy status: DNS only (siv oblaček)**, da certbot lahko izda certifikat. Oranžni oblaček lahko vklopiš kasneje.

### HTTPS (sistemski nginx + certbot)
```bash
sudo cp deploy/nginx-mark.pripravi.si.conf /etc/nginx/sites-available/mark.pripravi.si
sudo ln -s /etc/nginx/sites-available/mark.pripravi.si /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d mark.pripravi.si      # če certbot ni nameščen: sudo apt install -y certbot python3-certbot-nginx
curl -s https://mark.pripravi.si/health        # {"ok":true,"agents":["Mark"]}
```

## Slack – Event Subscriptions (ko backend teče)

1. api.slack.com/apps → Mark → **Event Subscriptions** → Enable Events: On
2. Request URL: `https://mark.pripravi.si/slack/mark/events` → mora pokazati zeleno kljukico *Verified*
3. Subscribe to bot events: `app_mention`, `message.im`
4. Save Changes → Slack bo zahteval **Reinstall app** → potrdi

## Test

V `#ai-marketing`: `@Mark pozdravljen, predstavi se v treh stavkih.`
Nato prva testna naloga iz razdelka 11 v `agent-company.md`.

## Dodajanje agenta

1. Nov Slack app, isti scopi.
2. V `src/index.js` dodaj vnos v `AGENTS` (ime = **Ime:** v razdelku 2, lastna pot npr. `/slack/ana/events`).
3. Nove env spremenljivke v `.env`.
4. V `agent-company.md` dodaj `### Agent 2` in `### <Ime> – spomin`.
5. `docker compose up -d --build`, nato Event Subscriptions za novi app.

## Okoljske spremenljivke

Glej `.env.example`. Vrednosti nikoli ne commitaj.
