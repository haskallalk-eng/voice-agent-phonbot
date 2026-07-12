import { SITE, TODAY } from './seo-pages.mjs';

export const BLOG_INDEX = {
  slug: 'blog',
  title: 'Phonbot Blog | KI-Telefonie, Anrufannahme und Automatisierung',
  description: 'Praxisnahe Artikel zu KI-Telefonassistenten, automatischer Anrufannahme, Terminbuchung, DSGVO und Telefonie für Friseursalons.',
  headline: 'Praxiswissen für Friseursalons: bessere Anrufannahme mit KI.',
  intro: 'Der Phonbot Blog erklärt, wie Friseursalons Telefonie, Termine und Rückrufe automatisieren können, ohne Vertrauen oder Datenschutz zu opfern.',
};

export const BLOG_POSTS = [
  {
    slug: 'rufweiterleitung-einrichten-typische-fehler',
    title: 'Rufweiterleitung einrichten: 9 typische Fehler vor dem KI-Testanruf',
    description: 'Welche Fehler Friseursalons bei Rufweiterleitung, KI-Telefonnummer, Testanruf und Fallback vermeiden sollten, bevor Phonbot live geht.',
    headline: 'Rufweiterleitung einrichten: die typischen Fehler, die vor dem ersten echten Anruf auffallen sollten.',
    datePublished: '2026-05-11',
    dateModified: TODAY,
    category: 'Telefonie',
    readingMinutes: 7,
    primaryKeyword: 'Rufweiterleitung einrichten',
    secondaryKeywords: ['Rufweiterleitung KI Telefon', 'KI Telefonnummer Testanruf', 'Telefonweiterleitung Fehler'],
    intent: 'Praktische Setup-Intention für Friseursalons, die ihre bestehende Nummer behalten und Anrufe sicher an einen KI-Telefonassistenten weiterleiten wollen.',
    reviewedBy: 'Phonbot SEO/Superhirn',
    summary: 'Eine Rufweiterleitung ist schnell aktiviert, aber nicht automatisch sauber. Vor dem Livegang müssen Zielnummer, Weiterleitungsart, Testanruf, Ansage, Kalender, Tickets, Datenschutz und Rückfallweg einmal aus Kundensicht geprüft werden.',
    sections: [
      {
        heading: 'Warum Rufweiterleitung oft an Kleinigkeiten scheitert',
        paragraphs: [
          'Viele Salons wollen ihre bestehende Telefonnummer behalten. Das ist sinnvoll, weil diese Nummer bereits auf Google, Website, Schaufenster, Visitenkarte, Rechnung und in Kundendaten steht. Die KI bekommt deshalb meist eine eigene Zielnummer, während die bekannte Nummer per Rufweiterleitung dorthin übergibt.',
          'Der technische Schritt wirkt einfach: Nummer eintragen, Weiterleitung aktivieren, fertig. In der Praxis entstehen Probleme aber selten beim Eintragen der Nummer selbst. Sie entstehen, wenn niemand testet, wann die Weiterleitung greift, welche Nummer beim Agenten ankommt, ob der Agent zum Salon passt und ob Kalender oder Ticket wirklich funktionieren.',
        ],
      },
      {
        heading: 'Fehler 1: sofort weiterleiten, obwohl das Team noch ans Telefon soll',
        paragraphs: [
          'Eine sofortige Weiterleitung ist nur richtig, wenn wirklich jeder Anruf zuerst beim KI-Agenten landen soll. Viele Salons wollen aber nur einen Auffangmodus: bei Besetzt, nach einigen Sekunden, außerhalb der Öffnungszeiten oder wenn niemand abnimmt.',
          'Vor dem Aktivieren sollte deshalb klar sein, welcher Modus gewünscht ist. Sonst beantwortet die KI plötzlich Anrufe, die eigentlich noch beim Team landen sollten. Das ist kein KI-Problem, sondern eine falsch gesetzte Telefonregel.',
        ],
      },
      {
        heading: 'Fehler 2: kein echter Testanruf aus Kundensicht',
        paragraphs: [
          'Ein Test im Dashboard reicht nicht immer. Wichtig ist ein echter Anruf von einem normalen Telefon, so wie später ein Kunde anruft. Dabei sollte man prüfen, ob der Agent richtig begrüßt, ob er den Salon richtig nennt, ob er Unterbrechungen akzeptiert und ob er keine internen Tool-Namen ausspricht.',
          'Der Testanruf sollte auch einmal absichtlich schief laufen: Kunde nennt eine falsche E-Mail, korrigiert die Uhrzeit, fragt nach Datenschutz oder will abbrechen. Genau diese Fälle zeigen, ob der Agent robust genug für Live-Telefonie ist.',
        ],
      },
      {
        heading: 'Fehler 3: die falsche Zielnummer oder alte Agent-Version nutzen',
        paragraphs: [
          'Wenn ein Agent neu deployed wurde, können alte Testnummern, alte Retell-Agenten oder alte Weiterleitungsziele noch auf eine frühere Konfiguration zeigen. Dann klingt der Agent anders als erwartet oder nutzt alte Tools.',
          'Vor dem Livegang sollte die aktuell hinterlegte Phonbot-Nummer mit dem Dashboard und dem letzten Agent-Deploy abgeglichen werden. Erst wenn der Testanruf wirklich den aktuellen Agenten erreicht, gehört die Weiterleitung auf die Geschäftsnummer.',
        ],
      },
      {
        heading: 'Fehler 4: Kalender und Tickets nicht mit der Weiterleitung testen',
        paragraphs: [
          'Ein Agent kann sprachlich gut wirken und trotzdem funktional unsicher sein. Entscheidend ist, ob er bei einem echten weitergeleiteten Anruf Termine nur nach freien Slots bucht, Absagen oder Verschiebungen korrekt behandelt und Tickets nicht doppelt anlegt.',
          'Wenn Kalender, Mitarbeiterkalender oder Rückruf-Tickets verbunden sind, gehören sie in den Test. Der Agent darf nie behaupten, ein Termin sei gebucht, verschoben oder storniert, wenn das Tool keinen erfolgreichen Rückgabewert geliefert hat.',
        ],
      },
      {
        heading: 'Fehler 5: Datenschutztext klingt richtig, passt aber nicht zur Einstellung',
        paragraphs: [
          'Der Agent sollte nicht mehr versprechen, als technisch eingestellt ist. Wenn Audio und Transkript nicht dauerhaft gespeichert werden, darf das klar gesagt werden. Wenn eine Aufzeichnung oder Auswertung aktiv ist, braucht der Anrufer eine passende Information und gegebenenfalls Einwilligung.',
          'Wichtig ist die Produktwahrheit: Einstellungen für Aufzeichnung, Transkript, Aufbewahrung und anonymisierte Muster müssen zum Prompt passen. Ein Datenschutzsatz, der gut klingt, aber nicht zur Konfiguration passt, ist gefährlicher als eine kurze ehrliche Erklärung.',
        ],
      },
      {
        heading: 'Fehler 6: keine Rückfallregel bei Störung',
        paragraphs: [
          'Telefonie, Kalender, KI-Modell und externe Tools können langsam antworten oder kurz ausfallen. Deshalb braucht der Agent einen ruhigen Rückfallweg: Rückruf aufnehmen, menschliche Übergabe anbieten oder sagen, dass die Buchung gerade nicht bestätigt werden kann.',
          'Schlecht ist eine Antwort wie "Das ist erledigt", wenn die Funktion nicht erfolgreich war. Gut ist: "Ich kann das gerade nicht sicher eintragen. Ich nehme Ihren Rückrufwunsch auf und leite ihn weiter."',
        ],
      },
      {
        heading: 'Fehler 7: Minuten und Plan nicht zum echten Anrufvolumen prüfen',
        paragraphs: [
          'Der Nummer-Plan ist ein günstiger Einstieg mit eigener KI-Telefonnummer und 70 Minuten pro Monat. Für echte operative Anrufannahme ist aber oft ein größerer Plan sinnvoll, weil Testanrufe, echte Kundenfragen und längere Buchungsdialoge Minuten verbrauchen.',
          'Vor dem Livegang sollte man grob schätzen, wie viele Anrufe pro Woche realistisch sind. Wenn der Agent jeden Tag mehrere Gespräche führen soll, ist Starter oder höher meist der praktischere Rahmen als nur eine technische Nummer.',
        ],
      },
    ],
    checklist: [
      'Aktuelle Phonbot-Zielnummer aus dem Dashboard kopieren und alte Testziele entfernen.',
      'Weiterleitungsart bewusst wählen: sofort, bei Besetzt, nach Zeit oder außerhalb der Öffnungszeiten.',
      'Mindestens einen echten Testanruf von einem normalen Telefon machen.',
      'Im Test Terminbuchung, Terminverschiebung, Absage, Rückruf und Fehlersituation prüfen.',
      'Prompt und Datenschutztext gegen die echten Speicher- und Aufzeichnungseinstellungen abgleichen.',
      'Rückfallweg für Timeout, leeres Kalenderergebnis und Tool-Fehler definieren.',
      'Nach dem ersten Live-Anruf im Dashboard kontrollieren, ob Ticket, Kalender und Benachrichtigung stimmen.',
    ],
    faq: [
      ['Welche Rufweiterleitung ist für einen KI-Telefonassistenten am besten?', 'Das hängt vom Salon ab. Wenn die KI alle Anrufe annehmen soll, passt sofortige Weiterleitung. Wenn das Team zuerst rangehen soll, sind Weiterleitung bei Besetzt, nach Zeit oder außerhalb der Öffnungszeiten meist besser.'],
      ['Muss ich meine bestehende Telefonnummer ersetzen?', 'Nein. Meist bleibt die bestehende Nummer sichtbar und leitet technisch auf die Phonbot-Zielnummer weiter.'],
      ['Wie teste ich die Rufweiterleitung richtig?', 'Rufe von einem normalen Telefon die echte Geschäftsnummer an, nicht nur die KI-Zielnummer. Prüfe Begrüßung, Salon-Angaben, Datenschutzhinweis, Kalender- oder Ticketfunktion und den Rückfallweg bei Fehlern.'],
      ['Was soll der Agent sagen, wenn ein Tool nicht funktioniert?', 'Er sollte keine Aktion erfinden. Richtig ist eine kurze Erklärung, dass die Eintragung gerade nicht sicher bestätigt werden kann, plus Rückruf oder menschliche Übergabe.'],
    ],
    related: ['kontakt', 'friseur'],
  },
  {
    slug: 'ki-telefonassistent-kosten-roi-kleine-unternehmen',
    title: 'KI-Telefonassistent Kosten: Wann lohnt sich Phonbot?',
    description: 'Was Friseursalons bei Kosten, Minuten, verpassten Anrufen und Amortisation eines KI-Telefonassistenten realistisch rechnen sollten.',
    headline: 'KI-Telefonassistent Kosten: ab wann sich Phonbot rechnet.',
    datePublished: '2026-05-06',
    dateModified: TODAY,
    category: 'Kosten und ROI',
    readingMinutes: 7,
    primaryKeyword: 'KI Telefonassistent Kosten',
    secondaryKeywords: ['Voice Agent Kosten', 'Telefonassistent ROI', 'Phonbot Preise'],
    intent: 'Kaufnahe Informationsintention für Friseursalons, die Kosten, Nutzen und Planwahl eines KI-Telefonassistenten bewerten wollen.',
    reviewedBy: 'Phonbot SEO/Superhirn',
    summary: 'Die Kostenfrage ist nicht nur der Monatspreis. Entscheidend ist, wie viele Anrufe sonst verloren gehen, wie viel Zeit das Team spart und ob der Agent echte Termine oder Rückrufe erzeugt.',
    sections: [
      {
        heading: 'Warum der Monatspreis allein zu kurz greift',
        paragraphs: [
          'Viele Salons vergleichen einen KI-Telefonassistenten zuerst mit einer Telefonistin oder mit einem Anrufbeantworter. Beides greift zu kurz. Der echte Vergleich ist: Was kostet ein verpasster Anruf, wenn daraus ein Termin oder ein Rückruf hätte entstehen können?',
          'Gerade Friseursalons bekommen Anrufe oft in den Momenten, in denen niemand abheben kann: mitten im Haarschnitt, während die Farbe einwirkt oder außerhalb der Öffnungszeiten. Ein KI-Agent lohnt sich, wenn er diese Lücke schließt und aus spontanen Anrufen strukturierte Chancen macht.',
        ],
      },
      {
        heading: 'Welche Kosten bei KI-Telefonie entstehen',
        bullets: [
          'Grundpreis für den gewählten Phonbot-Plan.',
          'Inklusive Minuten je nach Plan und mögliche Mehrminuten bei hoher Nutzung.',
          'Telefonnummer oder Rufweiterleitung von der bestehenden Geschäftsnummer.',
          'Einrichtungszeit für Leistungen, Öffnungszeiten, FAQ und Kalenderregeln.',
          'Interne Nachbearbeitung für Tickets, Rückrufe oder komplexe Sonderfälle.',
        ],
      },
      {
        heading: 'Eine einfache ROI-Rechnung für Friseursalons',
        paragraphs: [
          'Eine pragmatische Rechnung beginnt mit drei Zahlen: Wie viele Anrufe werden pro Woche verpasst? Wie viele davon sind potenzielle Kunden? Und wie viel ist ein gewonnener Termin im Schnitt wert? Schon wenige gerettete Anfragen pro Monat können den Starter-Plan rechtfertigen, wenn der durchschnittliche Terminwert nicht sehr niedrig ist.',
          'Beispiel: Wenn ein Friseursalon nur zwei zusätzliche zahlende Kunden im Monat gewinnt, kann der Nutzen höher sein als die laufenden Kosten. Noch nicht eingerechnet ist die Entlastung im Team, weil Standardfragen, Terminwünsche und Rückrufnotizen nicht mehr nebenbei am Telefon sortiert werden müssen.',
        ],
      },
      {
        heading: 'Welcher Phonbot-Plan für welchen Fall passt',
        paragraphs: [
          'Der Nummer-Plan ab 8,99 EUR pro Monat ist der günstige Einstieg für eine eigene KI-Telefonnummer und enthält 70 Minuten pro Monat. Für regelmäßige operative Telefonie mit mehr Volumen ist Starter oder höher der bessere Automatisierungsplan.',
          'Der Starter-Plan ab 89 EUR pro Monat passt für Salons, die wirklich Anrufe annehmen, Termine vorbereiten oder buchen und Rückruf-Tickets erzeugen wollen. Professional und Agency sind sinnvoll, wenn mehrere Agents, mehr Minuten oder mehrere Standorte gebraucht werden.',
        ],
      },
      {
        heading: 'Woran man erkennt, dass sich der Agent verbessert',
        paragraphs: [
          'Ein guter KI-Telefonassistent wird nicht einmal eingestellt und dann vergessen. Nach den ersten echten Anrufen sollten typische Fragen, Missverständnisse und Abbruchstellen ausgewertet werden. Daraus entstehen bessere FAQ, klarere Tool-Regeln und stabilere Antworten.',
          'Für SEO und Produktqualität ist genau dieser Praxisbezug wichtig: Phonbot sollte nicht versprechen, dass jeder Anruf automatisch Umsatz wird. Stark ist die ehrliche Aussage, dass der Agent erreichbar ist, Daten sauber sammelt, keine Tool-Ergebnisse erfindet und bei Unsicherheit einen Rückruf vorbereitet.',
        ],
      },
    ],
    checklist: [
      'Verpasste Anrufe pro Woche realistisch schätzen.',
      'Durchschnittlichen Wert eines Termins notieren.',
      'Starter-Plan mit 300 Minuten pro Monat als operativen Standard prüfen.',
      'Nach dem ersten Monat Anrufgründe, Tickets und Buchungen auswerten.',
      'Prompt, FAQ und Kalenderregeln anhand echter Anrufe verbessern.',
    ],
    faq: [
      ['Was kostet ein KI-Telefonassistent bei Phonbot?', 'Der Einstieg mit eigener KI-Telefonnummer startet ab 8,99 EUR pro Monat. Für operative Anrufannahme mit 300 Minuten pro Monat startet der Starter-Plan bei 89 EUR pro Monat.'],
      ['Wann lohnt sich ein KI-Telefonassistent?', 'Wenn regelmäßig Anrufe verloren gehen, das Team unterbrochen wird oder Termine und Rückrufe außerhalb der Öffnungszeiten entstehen.'],
      ['Ist der günstigste Plan genug für meinen Salon?', 'Der Nummer-Plan ist gut für die technische Telefon-Anbindung. Für laufende Automatisierung, Termine und den echten Salon-Alltag ist Starter oder höher meist passender.'],
    ],
    related: ['friseur', 'kontakt'],
  },
  {
    slug: 'ki-telefonassistent-friseur-terminbuchung',
    title: 'KI-Telefonassistent für Friseure: Termine automatisch buchen | Phonbot',
    description: 'Wie Friseursalons mit einem KI-Telefonassistenten Terminanfragen, Wunschfriseur, Leistungen und Rückrufe strukturiert aufnehmen.',
    headline: 'KI-Telefonassistent für Friseure: wann er hilft und wo die Grenze liegt.',
    datePublished: '2026-05-05',
    dateModified: TODAY,
    category: 'Friseur',
    readingMinutes: 6,
    primaryKeyword: 'KI Telefonassistent Friseur',
    secondaryKeywords: ['Telefonassistent Friseursalon', 'automatische Terminbuchung Salon', 'KI Anrufannahme Friseur'],
    intent: 'Kauf- und Informationsintention für Saloninhaber, die Terminanrufe automatisieren wollen.',
    reviewedBy: 'Phonbot SEO/Superhirn',
    summary: 'Ein guter Salon-Agent nimmt nicht nur Namen auf. Er muss Leistung, Dauer, Wunschfriseur, Neukundenstatus und Kalenderverfügbarkeit sauber zusammenbringen.',
    sections: [
      {
        heading: 'Warum Salons besonders stark vom Telefon abhängen',
        paragraphs: [
          'Friseursalons verlieren Anfragen oft nicht, weil niemand Termine vergeben will, sondern weil der beste Zeitpunkt für einen Kundenanruf genau in eine Behandlung fällt. Beim Schneiden, Färben oder Föhnen ist das Telefon störend, gleichzeitig kann ein verpasster Anruf direkt zu einem anderen Salon wechseln.',
          'Ein KI-Telefonassistent lohnt sich deshalb vor allem für wiederkehrende Standardanfragen: Haarschnitt, Farbe, Beratung, Öffnungszeiten, Preise, Absage, Verschiebung und Rückruf. Die Aufgabe ist nicht, den Salon menschlich zu ersetzen, sondern die Lücke zwischen Anruf und Rückmeldung zu schließen.',
        ],
      },
      {
        heading: 'Welche Daten der Agent vor einer Buchung braucht',
        bullets: [
          'Name und Rückrufnummer des Kunden.',
          'Leistung, grobe Dauer und besondere Hinweise wie Farbe, Balayage oder Beratung.',
          'Wunschdatum, Uhrzeit und optional Wunschfriseur.',
          'Bestandskunde oder Neukunde, falls das Kundenmodul aktiv ist.',
          'Ausdrückliche Bestätigung des Termins, bevor der Kalender beschrieben wird.',
        ],
      },
      {
        heading: 'Was ein guter Friseur-Agent niemals tun sollte',
        paragraphs: [
          'Der Agent darf keinen Termin erfinden, wenn der Kalender keine freie Zeit liefert. Er darf auch nicht behaupten, etwas sei gebucht, solange das Tool keine erfolgreiche Antwort gegeben hat. Gerade bei Mitarbeiterkalendern ist es wichtig, nicht einfach einen allgemeinen Salon-Slot zu nehmen, wenn eigentlich eine bestimmte Person gewünscht wurde.',
          'Bei komplexen Farb- oder Chemiefragen sollte der Agent nicht beraten. Besser ist eine kurze Einordnung: Er nimmt Vorbehandlung, Allergie- oder Kopfhaut-Hinweise auf und erstellt ein Rückruf- oder Beratungsticket.',
        ],
      },
      {
        heading: 'So passt Phonbot in den Salon-Alltag',
        paragraphs: [
          'Phonbot fragt strukturiert nach Leistung, Terminwunsch und Kontakt. Wenn ein Kalender verbunden ist, prüft der Agent freie Slots und bestätigt erst nach erfolgreicher Buchung. Wenn kein Slot passt, wird kein falscher Termin versprochen, sondern ein Rückruf oder eine Wartelistenanfrage vorbereitet.',
          'Der Starter-Plan ab 89 EUR pro Monat ist der realistische Einstieg für vollständige Terminbuchung. Der Nummer-Plan ab 8,99 EUR pro Monat ist prima für eine eigene KI-Telefonnummer, aber nicht der vollständige Salon-Automatisierungsplan.',
        ],
      },
    ],
    checklist: [
      'Leistungen mit Dauer im Agent Builder pflegen.',
      'Kalender pro Mitarbeiter verbinden, wenn Wunschfriseur wichtig ist.',
      'Klare Regeln für Farbberatung und sensible Hinweise setzen.',
      'Rückruf-Tickets für unklare oder riskante Fälle aktivieren.',
      'Nach den ersten echten Anrufen Prompt und FAQ nachschärfen.',
    ],
    faq: [
      ['Kann ein KI-Telefonassistent Friseurtermine direkt buchen?', 'Ja, wenn ein Kalender verbunden ist und alle Pflichtdaten vorliegen. Der Agent sollte erst nach Nutzerbestätigung und erfolgreicher Tool-Antwort zusagen.'],
      ['Kann der Agent mehrere Mitarbeiter unterscheiden?', 'Ja. Dafür müssen Mitarbeiter, Leistungen und Kalender sauber hinterlegt sein.'],
      ['Ist ein KI-Agent für Farbberatung geeignet?', 'Nur begrenzt. Er kann Hinweise aufnehmen und Beratungstermine vorbereiten, aber keine individuelle fachliche Bewertung ersetzen.'],
    ],
    related: ['friseur'],
  },
  {
    slug: 'dsgvo-ki-telefonassistent-aufzeichnung',
    title: 'DSGVO und KI-Telefonassistent: Aufzeichnung, Transkript und sichere Defaults',
    description: 'Welche Datenschutzfragen bei KI-Telefonassistenten wichtig sind: Einwilligung, Metadaten, Aufzeichnung, Transkript, AVV und Subprozessoren.',
    headline: 'DSGVO bei KI-Telefonassistenten: was vor dem ersten Live-Anruf klar sein muss.',
    datePublished: '2026-05-05',
    dateModified: TODAY,
    category: 'Datenschutz',
    readingMinutes: 7,
    primaryKeyword: 'DSGVO KI Telefonassistent',
    secondaryKeywords: ['Voice Bot Datenschutz', 'Telefonanruf Aufzeichnung Einwilligung', 'KI Telefonie AVV'],
    intent: 'Informations- und Kaufhürde für Friseursalons, die KI-Telefonie rechtssicher einsetzen wollen.',
    reviewedBy: 'Phonbot SEO/Superhirn',
    summary: 'Datenschutz ist bei Voice Agents kein Footer-Thema. Die wichtigsten Entscheidungen betreffen Einwilligung, Speicherfristen, Aufzeichnung, Transkript und Anbietergrenzen.',
    sections: [
      {
        heading: 'Warum Datenschutz bei Telefonie besonders sensibel ist',
        paragraphs: [
          'Telefonate enthalten schnell personenbezogene Daten: Name, Telefonnummer, Terminwunsch, Adresse, Anliegen oder interne Rückrufnotizen. Auch im Salonalltag kommen vertrauliche Hinweise wie Allergien oder Kopfhaut-Themen hinzu. Deshalb braucht ein KI-Telefonassistent klare Regeln, bevor er live geht.',
          'Wichtig ist die Trennung zwischen Anrufmetadaten, Transkript, Audio und daraus abgeleiteten Mustern. Nicht jede technische Möglichkeit ist automatisch sinnvoll oder erforderlich.',
        ],
      },
      {
        heading: 'Welche Entscheidungen vor dem Deploy fallen sollten',
        bullets: [
          'Soll Audio gespeichert werden oder nur für den Live-Call verarbeitet werden?',
          'Soll ein Transkript gespeichert werden, und wenn ja, wie lange?',
          'Welche Metadaten sind für Abrechnung und Support nötig?',
          'Welche Subprozessoren werden für Telefonie, KI, Kalender und E-Mail eingesetzt?',
          'Welche Anliegen sind ausgeschlossen, weil sie zu sensibel sind?',
        ],
      },
      {
        heading: 'Einwilligung und klare Kommunikation',
        paragraphs: [
          'Der Agent sollte früh und knapp sagen, dass es sich um einen KI-Assistenten handelt und welche Daten verarbeitet werden. Wenn Aufzeichnung oder Transkript gespeichert werden, muss der Nutzer verstehen, wozu das passiert. Lehnt der Anrufer eine optionale Aufzeichnung ab, sollte der Agent nicht automatisch auflegen, sondern mit datensparsamer Verarbeitung weiterhelfen, sofern der konkrete Zweck das erlaubt.',
          'Kritisch sind Formulierungen wie "alles DSGVO-konform" ohne Kontext. Besser ist konkrete Wahrheit: AVV verfügbar, Speicherfristen einstellbar, Subprozessoren transparent, Audio optional, Metadaten für Abrechnung nötig.',
        ],
      },
      {
        heading: 'Wie Phonbot damit umgehen sollte',
        paragraphs: [
          'Phonbot sollte sichere Defaults nutzen: keine unnötige Speicherung, klare Retention, transparente Subprozessoren und sichtbare AVV-/Datenschutz-Seiten. Für anonymisierte Pattern darf nur gearbeitet werden, wenn personenbezogene Daten vorher entfernt werden und der Kunde bewusst zugestimmt hat.',
          'Die beste SEO-Wirkung entsteht hier nicht durch juristische Schlagworte, sondern durch konkrete Antworten auf echte Kaufhürden: Was wird gespeichert? Wie lange? Wer verarbeitet Daten? Was passiert bei Widerruf? Was bleibt für Abrechnung nötig?',
        ],
      },
    ],
    checklist: [
      'KI-Hinweis im Prompt aktivieren.',
      'Audio- und Transkript-Speicherung bewusst konfigurieren.',
      'Speicherfristen je Kunde dokumentieren.',
      'AVV, Datenschutz und Subprozessoren verlinken.',
      'Sensible Anliegen mit klaren Grenzen versehen.',
    ],
    faq: [
      ['Muss ein KI-Telefonassistent immer aufzeichnen?', 'Nein. Ein Voice Agent kann je nach Setup auch ohne dauerhafte Audio- oder Transkriptspeicherung betrieben werden.'],
      ['Was muss der Anrufer wissen?', 'Er sollte erkennen, dass er mit einem KI-Assistenten spricht und welche Daten für welchen Zweck verarbeitet werden.'],
      ['Sind Anrufmetadaten dasselbe wie Transkripte?', 'Nein. Metadaten wie Datum, Dauer und Rufnummer sind etwas anderes als Audio oder vollständige Gesprächsinhalte.'],
    ],
    related: [],
  },
  {
    slug: 'rufweiterleitung-ki-telefonnummer',
    title: 'Rufweiterleitung zur KI-Telefonnummer: bestehende Nummer behalten | Phonbot',
    description: 'Wie Friseursalons ihre bestehende Nummer behalten und Anrufe per Rufweiterleitung an einen KI-Telefonassistenten übergeben.',
    headline: 'Rufweiterleitung zur KI-Telefonnummer: kein Nummernwechsel nötig.',
    datePublished: '2026-05-05',
    dateModified: TODAY,
    category: 'Telefonie',
    readingMinutes: 5,
    primaryKeyword: 'Rufweiterleitung KI Telefonnummer',
    secondaryKeywords: ['bestehende Nummer KI Telefonassistent', 'Telefonnummer weiterleiten Voice Bot', 'KI Anrufannahme Rufumleitung'],
    intent: 'Praktische Setup-Frage für Friseursalons, die ihre bestehende Telefonnummer behalten wollen.',
    reviewedBy: 'Phonbot SEO/Superhirn',
    summary: 'Viele Salons wollen keine neue Nummer bewerben. Mit Rufweiterleitung kann die bestehende Nummer bleiben, während der KI-Agent Anrufe annimmt.',
    sections: [
      {
        heading: 'Warum die bestehende Nummer bleiben sollte',
        paragraphs: [
          'Eine Geschäftsnummer steht auf Website, Google Business Profile, Schaufenster, Visitenkarten, Rechnungen und in alten Kundendaten. Ein Nummernwechsel erzeugt Reibung. Für einen Friseursalon ist es daher meist besser, die gewohnte Nummer zu behalten und Anrufe technisch weiterzuleiten.',
          'Der KI-Telefonassistent bekommt dafür eine eigene Zielnummer. Die alte Nummer bleibt sichtbar, während eingehende Anrufe je nach Regel direkt, bei Besetzt oder nach Zeitablauf an die KI-Nummer gehen.',
        ],
      },
      {
        heading: 'Welche Weiterleitungsarten sinnvoll sind',
        bullets: [
          'Sofortige Weiterleitung: Alle Anrufe gehen direkt zum KI-Agenten.',
          'Weiterleitung bei Besetzt: Der Agent springt ein, wenn das Team telefoniert.',
          'Weiterleitung nach Zeit: Erst klingelt das Team, danach übernimmt der Agent.',
          'Weiterleitung außerhalb der Öffnungszeiten: Tagsüber Team, abends KI-Agent.',
        ],
      },
      {
        heading: 'Was vor dem Aktivieren getestet werden sollte',
        paragraphs: [
          'Vor dem Live-Schalten sollte ein Testanruf aus Kundensicht erfolgen. Wichtig sind Begrüßung, KI-Hinweis, korrekte Salon-Angaben, Rufnummernanzeige, Ticket- oder Kalenderfunktion und die Frage, ob der Agent bei Unsicherheit sauber einen Rückruf anbietet.',
          'Auch die Minutenlogik gehört dazu. Der Nummer-Plan enthält 70 Minuten pro Monat. Für regelmäßige monatliche Telefonie mit vielen Anrufen ist Starter oder höher der bessere operative Plan.',
        ],
      },
      {
        heading: 'Wie Phonbot den Ablauf abbildet',
        paragraphs: [
          'Phonbot stellt eine deutsche Festnetznummer bereit. Im Dashboard kann der Salon den Agenten konfigurieren, Testanrufe machen und anschließend die bestehende Nummer beim eigenen Anbieter weiterleiten.',
          'Damit kein Anruf im Nirgendwo landet, sollte die Weiterleitung erst nach einem erfolgreichen Test aktiviert werden. Bei Problemen gehören klare Fehlertexte und Rückfalloptionen in den Setup-Flow.',
        ],
      },
    ],
    checklist: [
      'Phonbot-Nummer bereitstellen.',
      'Agent mit Salon-Leistungen und Öffnungszeiten deployen.',
      'Testanruf machen und Tool-Funktionen prüfen.',
      'Rufweiterleitung beim Anbieter aktivieren.',
      'Nach dem ersten echten Anruf Ticket, Kalender und Benachrichtigung kontrollieren.',
    ],
    faq: [
      ['Muss ich meine alte Telefonnummer ersetzen?', 'Nein. In den meisten Fällen reicht eine Rufweiterleitung auf die Phonbot-Nummer.'],
      ['Kann der Agent nur außerhalb der Öffnungszeiten rangehen?', 'Ja, wenn die Weiterleitung oder Telefonie-Regel entsprechend eingerichtet ist.'],
      ['Was kostet die eigene KI-Nummer?', 'Der Nummer-Plan startet bei 8,99 EUR pro Monat und enthält 70 Minuten pro Monat.'],
    ],
    related: ['kontakt', 'friseur'],
  },
];

export function blogUrl(post) {
  return `${SITE}/blog/${post.slug}/`;
}
