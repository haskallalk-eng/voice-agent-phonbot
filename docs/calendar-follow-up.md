# Kalender: eindeutige Kundenzuordnung und kleinere Module

Stand: 26. Oktober 2026. Ausgangsrevision: `b02ebefdbabad5e1dfeb2dd32b68fbdf671939fe`. Die Änderungen dieses Nachtrags sind über die Dateihistorie und den zugehörigen Pull Request nachvollziehbar.

## Fehler und Verhalten

Die bisherige Navigation vom Termin zum Kunden konnte den ersten Treffer einer unscharfen Suche öffnen. Eine Suche nach „Anna“ konnte so beispielsweise zu „Johanna“ führen. Telefonnummernsuffixe und ein Name trotz widersprechender Telefonnummer wurden ebenfalls als mögliche Zuordnung akzeptiert.

Die gemeinsame Zuordnung in `apps/web/src/ui/calendar/customerLookup.ts` wird nun sowohl im Haupt- als auch im Mitarbeiterkalender verwendet:

- Eine vorhandene Telefonnummer muss vollständig übereinstimmen. Formatzeichen und ein internationales `00`-Präfix werden normalisiert; Ländervorwahlen werden nicht geraten.
- Ohne Telefonnummer ist nur ein vollständiger normalisierter Name verwendbar.
- Mehrere unterschiedliche passende Kunden führen zu einem sichtbaren Hinweis statt zur Navigation. Dieselbe Kunden-ID aus mehreren Suchergebnissen zählt nur einmal.
- Alle Suchantworten werden vor der Entscheidung zusammengeführt. Ein Fehler oder das Erreichen der Suchgrenze von 500 Treffern darf nicht als eindeutiges Ergebnis gelten.
- Fehler erscheinen auch im geöffneten Termindialog mit `role="alert"`.

Das ist eine konservative Navigationserleichterung, keine neue Authentifizierungs- oder Berechtigungsgrenze. Bei fehlender eindeutiger Zuordnung bleibt die manuelle Auswahl im Kundenmodul erforderlich. Eine nationale und eine internationale Schreibweise werden ohne gesicherten Länderkontext bewusst nicht gleichgesetzt.

## Begrenzte Umstrukturierung

Kalenderansichten und Hilfslogik wurden aus `CalendarPage.tsx` nach `calendar/CalendarViews.tsx` und `calendar/model.ts` verschoben. Dadurch sinkt die Hauptdatei von 3.177 auf etwa 2.200 Zeilen. Tages-, Wochen- und Monatsansichten sowie Gruppierung bleiben erhalten. Die verbleibende Hauptdatei ist weiterhin groß; dies ist ein abgegrenzter erster Schritt.

## Prüfung

Lokal bestanden:

```sh
corepack pnpm --filter @vas/web typecheck
corepack pnpm --filter @vas/web run test --run
corepack pnpm --filter @vas/web build
node scripts/check-secrets.mjs
```

23 Web-Tests in drei Dateien: 18 Fälle für die Kundenzuordnung, drei Render-/Gruppierungsregressionen der ausgelagerten Ansichten und zwei bestehende Checkout-Regressionen. Zu den Fällen gehören Teilnamen, widersprechende oder verkürzte Nummern, gleichnamige Kunden, doppelte Suchergebnisse, Suchfehler und eine ausgeschöpfte Treffergrenze.

Die Ansichtstests prüfen serverseitig gerendertes React-Markup und Gruppierungsdaten. Sie ersetzen keine interaktive Browser- oder Live-Telefonie-Abnahme. API-, Datenbank-, Telefonie- und Deployment-Verhalten werden durch diesen Nachtrag nicht geändert. Der PR durchläuft zusätzlich die bestehende Repository-CI mit allen Workspace-Tests und isolierter PostgreSQL-Prüfung; den konkreten CI-Status zeigt GitHub am PR.
