# 🧹 Ämtliplan

Eine kleine Familien-Website für die Ämtli im Haushalt. Das Konto `admin`
legt Ämtli an und gibt jedem Ämtli Punkte. Renata, Adi, Jan und Elisabeth
haken ab, was sie erledigt haben, und sammeln Punkte für das Monatsziel.

Gleicher Aufbau wie das Hiking-Dashboard: statische Dateien auf GitHub Pages,
Supabase für Daten und Logins. Kein Build-Schritt, kein Framework.

- **Tägliche Ämtli** können einmal pro Tag abgehakt werden, von der Person,
  die sie erledigt. Um Mitternacht (Schweizer Zeit) beginnen sie von vorne.
- **Spezial-Ämtli** sind einmalig, z. B. Fenster putzen. Sie können eine Frist
  haben. Wer es zuerst erledigt, bekommt die Punkte.
- **Monatsziel:** so viele Punkte soll jede Person erreichen. Alle haben einen
  Fortschrittsbalken, frühere Monate kann man durchblättern.
- **Verlauf:** wer hat was wann gemacht. Eigene Einträge kann man am selben
  Tag rückgängig machen. Admins können alle Einträge rückgängig machen.
- **Admins** (das Konto `admin`) legen Ämtli an, ändern und entfernen sie und setzen das
  Ziel. Admins können ein Ämtli auch *für* jemand anderen abhaken.
- **Login nur mit Name und Passwort**, z. B. `jan`.
- Funktioniert auf dem Handy und im Dark Mode. Aktualisiert sich alle 30
  Sekunden und sobald man zum Tab zurückkehrt.

## Einrichtung

### 1. Supabase

1. Ein Projekt auf [supabase.com](https://supabase.com) erstellen. Das
   Hiking-Dashboard-Projekt kann auch wiederverwendet werden, die
   Tabellennamen kommen sich nicht in die Quere.
2. **SQL Editor → New query**: [`schema.sql`](schema.sql) einfügen und
   **Run** klicken.
3. **Authentication → Sign In / Providers**: "Allow new users to sign up"
   **ausschalten**. So kommen nur die Leute rein, die du selbst hinzufügst.
4. **Authentication → Users → Add user → Create new user**, für jede Person
   einmal, mit Passwort und angehaktem **Auto Confirm User**:

   | Person | E-Mail im Dashboard | Login auf der Seite |
   |---|---|---|
   | Admin (verteilt die Ämtli) | `admin@example.com` | `admin` |
   | Renata | `renata@example.com` | `renata` |
   | Adi | `adi@example.com` | `adi` |
   | Jan | `jan@example.com` | `jan` |
   | Elisabeth | `elisabeth@example.com` | `elisabeth` |

   Name und Admin-Recht setzt die Datenbank automatisch: der Name kommt aus
   dem Teil vor dem `@`, und nur `admin@…` wird Admin. `example.com` ist eine
   reservierte Test-Domain, es werden nie E-Mails verschickt.

5. **Project Settings → API Keys**: die **Project URL** und den
   **publishable** Key kopieren.

### 2. `config.js`

```js
window.CHORE_CONFIG = {
  SUPABASE_URL: "https://abcdefgh.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_...",
  LOGIN_DOMAIN: "example.com", // Login "jan" = jan@example.com
};
```

Solange das leer ist, läuft die Seite im **Demo-Modus**: erfundene Daten, nur
im eigenen Browser gespeichert, und statt einem Login wählt man, wer man ist.
Praktisch, um Renata zuerst zu zeigen, wie es funktioniert.

### 3. GitHub Pages

```bash
git init
git add .
git commit -m "Ämtliplan"
git branch -M main
git remote add origin https://github.com/adiikxx/aemtliplan.git
git push -u origin main
```

Danach im Repo **Settings → Pages → Deploy from a branch**, Branch `main`,
Ordner `/ (root)`. Die Seite ist dann unter
`https://adiikxx.github.io/aemtliplan/` erreichbar.

## Sicherheit

Der publishable Key ist absichtlich öffentlich. Wer was darf, regelt die
Row Level Security in `schema.sql`:

- Nur angemeldete Personen sehen überhaupt etwas.
- Nur Admins können Ämtli und Ziele anlegen oder ändern.
- Alle anderen können Ämtli nur für sich selbst und nur für heute abhaken,
  und nur ihre eigenen Einträge von heute rückgängig machen.
- Die Punkte eines Eintrags kommen aus der Datenbank, nicht aus dem Browser.
  Werden die Punkte eines Ämtli später geändert, bleiben verdiente Punkte
  gleich.
- Niemand kann sich über die Website selbst zum Admin machen. Das geht nur im
  SQL Editor.

Ein vergessenes Passwort lässt sich unter **Authentication → Users**
zurücksetzen (**⋯**-Menü beim jeweiligen Benutzer).

## Dateien

| Datei | Inhalt |
|---|---|
| `index.html` | Seitenstruktur |
| `styles.css` | Styling, hell + dunkel |
| `app.js` | Darstellung, Regeln, Supabase- und Demo-Speicher |
| `config.js` | Project URL und publishable Key |
| `schema.sql` | Tabellen, Abhak-Regeln, Row Level Security |

## Lokal ansehen

```bash
python3 -m http.server 8000
```

Dann http://localhost:8000 öffnen.
