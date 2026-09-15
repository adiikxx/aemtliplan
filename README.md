# 🧹 Ämtliplan

Eine kleine Familien-Website für die Ämtli im Haushalt. Admin legt Ämtli an und
gibt jedem Ämtli Punkte. Renata, Adi, Jan und Elisabeth haken ab, was sie
erledigt haben, und sammeln Punkte für das Monatsziel.

Gleicher Aufbau wie das Hiking-Dashboard: statische Dateien auf GitHub Pages,
Supabase für die gemeinsamen Daten. Kein Build-Schritt, kein Framework, keine
Passwörter.

- **Anmelden** = auf den eigenen Namen tippen. Das Gerät merkt sich das,
  mit **Abmelden** wechselt man die Person.
- **Tägliche Ämtli** können einmal pro Tag abgehakt werden, von der Person,
  die sie erledigt. Um Mitternacht (Schweizer Zeit) beginnen sie von vorne.
- **Spezial-Ämtli** sind einmalig, z. B. Fenster putzen. Sie können eine Frist
  haben. Wer es zuerst erledigt, bekommt die Punkte.
- **Monatsziel:** so viele Punkte soll jede Person erreichen. Alle haben einen
  Fortschrittsbalken, frühere Monate kann man durchblättern.
- **Verlauf:** wer hat was wann gemacht. Eigene Einträge kann man am selben
  Tag rückgängig machen, Admin kann alle Einträge rückgängig machen.
- **Admin** legt Ämtli an, ändert und entfernt sie, setzt das Ziel und kann
  ein Ämtli auch *für* jemand anderen abhaken.
- Funktioniert auf dem Handy und im Dark Mode. Aktualisiert sich alle 30
  Sekunden und sobald man zum Tab zurückkehrt.

## Einrichtung

1. In Supabase im **SQL Editor** [`schema.sql`](schema.sql) einfügen und
   **Run** klicken. Das legt die Tabellen und die fünf Personen an.
2. In [`config.js`](config.js) die **Project URL** und den **publishable** Key
   eintragen (Supabase → Project Settings → API Keys).
3. Auf GitHub Pages veröffentlichen (Settings → Pages → Branch `main`, Ordner
   `/ (root)`).

Solange `config.js` leer ist, läuft die Seite im **Demo-Modus** mit erfundenen
Daten, die nur im eigenen Browser gespeichert werden.

## Personen ändern

Die Liste steht in `schema.sql` beim `insert into public.profiles`. Namen
anpassen oder Zeilen hinzufügen und das Script im SQL Editor nochmals
ausführen. Die `id` ist ein kurzes Kürzel in Kleinbuchstaben (z. B. `jan`).

## Sicherheit

Es gibt absichtlich keine Logins. Wer den Link hat, kann auf jeden Namen
tippen und Ämtli abhaken oder als Admin Ämtli ändern, genau wie beim
Hiking-Dashboard. Für die Familie reicht das; den Link einfach nicht
öffentlich teilen.

Was die Datenbank trotzdem sicherstellt: tägliche Ämtli nur einmal pro Tag,
Spezial-Ämtli nur einmal, und die Punkte eines Eintrags kommen immer aus dem
Ämtli selbst.

## Dateien

| Datei | Inhalt |
|---|---|
| `index.html` | Seitenstruktur |
| `styles.css` | Styling, hell + dunkel |
| `app.js` | Darstellung, Regeln, Supabase- und Demo-Speicher |
| `config.js` | Project URL und publishable Key |
| `schema.sql` | Tabellen, Personen, Abhak-Regeln |

## Lokal ansehen

```bash
python3 -m http.server 8000
```

Dann http://localhost:8000 öffnen.
