import { SITE, TODAY } from './seo-pages.mjs';

export const BLOG_INDEX = {
  slug: 'blog',
  title: 'Phonbot Blog | KI-Telefonie, Anrufannahme und Automatisierung',
  description: 'Praxisnahe Artikel zu KI-Telefonassistenten, automatischer Anrufannahme, Terminbuchung, DSGVO und Telefonie fuer kleine Unternehmen.',
  headline: 'Praxiswissen fuer bessere Anrufannahme mit KI.',
  intro: 'Der Phonbot Blog erklaert, wie kleine Unternehmen Telefonie, Termine und Rueckrufe automatisieren koennen, ohne Vertrauen oder Datenschutz zu opfern.',
};

export const BLOG_POSTS = [
  {
    slug: 'ki-telefonassistent-selbststaendige',
    title: 'KI-Telefonassistent fuer Selbststaendige: erreichbar bleiben ohne Sekretariat',
    description: 'Wie Solo-Selbststaendige, Coaches und lokale Dienstleister mit Phonbot Anrufe annehmen, Rueckrufe vorbereiten und Termine sicher strukturieren.',
    headline: 'KI-Telefonassistent fuer Selbststaendige: erreichbar bleiben, ohne dauernd aus der Arbeit gerissen zu werden.',
    datePublished: '2026-05-20',
    dateModified: '2026-05-20',
    category: 'Selbststaendige',
    readingMinutes: 7,
    primaryKeyword: 'KI Telefonassistent Selbststaendige',
    secondaryKeywords: ['Telefonassistent fuer Selbststaendige', 'KI Anrufannahme Freelancer', 'automatische Terminannahme Selbststaendige'],
    intent: 'Kaufnahe Informationsintention fuer Solo-Selbststaendige, Coaches, Berater und kleine Dienstleister, die professioneller erreichbar sein wollen, ohne sofort Personal einzustellen.',
    reviewedBy: 'Phonbot SEO/Superhirn',
    summary: 'Selbststaendige brauchen keinen riesigen Callcenter-Prozess. Sie brauchen eine ruhige Anrufannahme, die Anliegen erkennt, Pflichtdaten sammelt, Termine nur nach Bestaetigung bucht und bei Unsicherheit einen Rueckruf vorbereitet.',
    sections: [
      {
        heading: 'Warum Selbststaendige am Telefon besonders verwundbar sind',
        paragraphs: [
          'Wer alleine arbeitet, kann nicht gleichzeitig beraten, behandeln, fahren, verkaufen und jeden Anruf sauber annehmen. Genau in diesen Momenten entstehen aber neue Auftraege: Ein Interessent will einen Termin, ein Bestandskunde hat eine Rueckfrage oder jemand vergleicht gerade mehrere Anbieter.',
          'Ein KI-Telefonassistent fuer Selbststaendige soll diese Luecke schliessen. Er ist kein Ersatz fuer persoenliche Beratung, sondern ein strukturierter Empfang: Er begruesst den Anrufer, erkennt das Anliegen, sammelt die noetigen Daten und macht aus einem spontanen Anruf einen klaren naechsten Schritt.',
        ],
      },
      {
        heading: 'Welche Aufgaben Phonbot fuer Solo-Betriebe uebernehmen kann',
        bullets: [
          'Anrufe sofort annehmen, wenn du im Termin, unterwegs oder ausserhalb der Oeffnungszeiten bist.',
          'Name, Rueckrufnummer, Anliegen, Wunschzeit und wichtige Hinweise strukturiert erfassen.',
          'Terminanfragen vorbereiten oder mit verbundenem Kalender nach freiem Slot buchen.',
          'Absagen, Verschiebungen und Rueckrufwuensche aufnehmen, ohne doppelte Aktionen zu versprechen.',
          'Standardfragen zu Leistungen, Ablauf, Oeffnungszeiten und Erreichbarkeit beantworten.',
          'Bei Unsicherheit oder sensiblen Themen einen menschlichen Rueckruf statt eine falsche Zusage anbieten.',
        ],
      },
      {
        heading: 'Der wichtigste Unterschied: Aufnahme statt Halluzination',
        paragraphs: [
          'Ein Selbststaendigen-Agent darf nicht so tun, als wuesste er alles. Wenn Preise, Leistungen oder freie Zeiten nicht hinterlegt sind, muss er nachfragen, einen Rueckruf vorbereiten oder klar sagen, dass er das nicht sicher bestaetigen kann. Das ist besser als eine schnelle, aber falsche Antwort.',
          'Besonders bei Terminen gilt: Der Agent sollte erst buchen, wenn Pflichtdaten vorliegen, der freie Slot aus dem Tool kommt und der Anrufer die konkreten Daten bestaetigt hat. Ohne erfolgreiche Tool-Antwort darf er nicht behaupten, der Termin sei eingetragen.',
        ],
      },
      {
        heading: 'Welche Daten vor einer Aktion wirklich noetig sind',
        bullets: [
          'Fuer Rueckruf: Name, Telefonnummer und kurzer Anlass.',
          'Fuer Terminwunsch: Name, Kontakt, Leistung oder Thema, Datum, Uhrzeit oder Zeitfenster.',
          'Fuer Buchung: bestaetigter Slot, passende Leistung, Kontaktmoeglichkeit und ausdrueckliche Bestaetigung.',
          'Fuer Verschiebung oder Absage: sicherer Bezug zum bestehenden Termin, neuer Wunsch oder klare Stornobestaetigung.',
          'Fuer komplexe Anliegen: genug Kontext fuer eine menschliche Nachbearbeitung, aber keine unnoetigen sensiblen Daten.',
        ],
      },
      {
        heading: 'Wie die Einrichtung in Phonbot praktisch aussieht',
        paragraphs: [
          'Im Phonbot-Dashboard werden Betrieb, Leistungen, Oeffnungszeiten, Mitarbeiter oder Einzelkalender, Wissensbasis und Datenschutzregeln gepflegt. Fuer Selbststaendige ist der Aufbau meist schlanker als bei einem groesseren Team: ein Kalender, klare Leistungen, wenige gute FAQ und ein Rueckrufprozess reichen oft fuer den Anfang.',
          'Wichtig ist ein echter Testanruf aus Kundensicht. Dabei sollte nicht nur geprueft werden, ob der Agent freundlich klingt. Entscheidend ist, ob er bei Korrekturen stoppt, E-Mail und Telefonnummer vorsichtig bestaetigt, keinen Tool-Namen ausspricht und bei Fehlern ruhig auf Rueckruf oder menschliche Uebergabe wechselt.',
        ],
      },
      {
        heading: 'Kosten realistisch bewerten',
        paragraphs: [
          'Fuer reine Telefon-Anbindung ist eine eigene KI-Telefonnummer der technische Einstieg. Fuer laufende operative Anrufannahme ist ein Plan mit genuegend Minuten sinnvoller. Der Starter-Plan ab 89 EUR pro Monat mit 300 Minuten ist fuer viele kleine Betriebe der realistische Startpunkt, wenn der Agent regelmaessig echte Anrufe annimmt.',
          'Die Frage ist nicht nur, was der Agent kostet. Entscheidend ist, wie viele Anrufe sonst verloren gehen, wie viel Zeit du im Alltag sparst und ob aus verpassten Anfragen wieder Rueckrufe, Termine oder Auftraege werden.',
        ],
      },
      {
        heading: 'Grenzen fuer Vertrauen und Datenschutz',
        paragraphs: [
          'Ein KI-Telefonassistent sollte keine Rechts-, Medizin-, Finanz- oder Fachberatung erfinden. Er kann Informationen aufnehmen, allgemeine Ablaufe erklaeren und Termine vorbereiten. Wenn es individuell, riskant oder unklar wird, gehoert der Fall zu einem Menschen.',
          'Auch Datenschutz gehoert in die Einrichtung. Der Agent sollte nur Daten sammeln, die fuer den konkreten Zweck gebraucht werden. Audio, Transkript, Metadaten und Speicherfristen muessen zur echten Konfiguration passen. Eine kurze ehrliche Erklaerung ist besser als ein grosser pauschaler DSGVO-Satz.',
        ],
      },
    ],
    checklist: [
      'Die fuenf haeufigsten Anrufgruende notieren und im Agent Builder als klare Regeln abbilden.',
      'Leistungen, Dauer, Oeffnungszeiten und Rueckrufprozess aktuell halten.',
      'Kalender nur verbinden, wenn Terminbuchung wirklich getestet wurde.',
      'Vor Buchung, Verschiebung oder Absage immer konkrete Daten bestaetigen lassen.',
      'Echte Testanrufe mit Korrekturen, Unterbrechungen und unvollstaendigen Daten machen.',
      'Nach den ersten Live-Anrufen Tickets, Buchungen und Fehlermeldungen auswerten.',
    ],
    faq: [
      ['Ist ein KI-Telefonassistent fuer Selbststaendige sinnvoll?', 'Ja, wenn regelmaessig Anrufe kommen, waehrend du nicht frei sprechen kannst. Besonders stark ist der Nutzen bei Terminwuenschen, Rueckrufen und wiederkehrenden Standardfragen.'],
      ['Kann Phonbot Termine fuer mich buchen?', 'Ja, wenn ein Kalender verbunden ist und der Agent alle Pflichtdaten gesammelt hat. Eine Buchung sollte erst nach konkreter Bestaetigung und erfolgreicher Tool-Antwort als erledigt gelten.'],
      ['Kann ich meine bestehende Telefonnummer behalten?', 'In vielen Faellen ja. Die bestehende Nummer kann technisch per Rufweiterleitung auf die Phonbot-Zielnummer uebergeben werden.'],
      ['Was passiert, wenn der Agent etwas nicht weiss?', 'Dann soll er nichts erfinden. Er fragt nach, bereitet einen Rueckruf vor oder sagt kurz, dass ein Mensch das klaeren muss.'],
    ],
    related: ['selbststaendig', 'kontakt', 'branchen'],
  },
  {
    slug: 'rufweiterleitung-einrichten-typische-fehler',
    title: 'Rufweiterleitung einrichten: 9 typische Fehler vor dem KI-Testanruf',
    description: 'Welche Fehler kleine Unternehmen bei Rufweiterleitung, KI-Telefonnummer, Testanruf und Fallback vermeiden sollten, bevor Phonbot live geht.',
    headline: 'Rufweiterleitung einrichten: die typischen Fehler, die vor dem ersten echten Anruf auffallen sollten.',
    datePublished: '2026-05-11',
    dateModified: TODAY,
    category: 'Telefonie',
    readingMinutes: 7,
    primaryKeyword: 'Rufweiterleitung einrichten',
    secondaryKeywords: ['Rufweiterleitung KI Telefon', 'KI Telefonnummer Testanruf', 'Telefonweiterleitung Fehler'],
    intent: 'Praktische Setup-Intention fuer Betriebe, die ihre bestehende Nummer behalten und Anrufe sicher an einen KI-Telefonassistenten weiterleiten wollen.',
    reviewedBy: 'Phonbot SEO/Superhirn',
    summary: 'Eine Rufweiterleitung ist schnell aktiviert, aber nicht automatisch sauber. Vor dem Livegang muessen Zielnummer, Weiterleitungsart, Testanruf, Ansage, Kalender, Tickets, Datenschutz und Rueckfallweg einmal aus Kundensicht geprueft werden.',
    sections: [
      {
        heading: 'Warum Rufweiterleitung oft an Kleinigkeiten scheitert',
        paragraphs: [
          'Viele Betriebe wollen ihre bestehende Telefonnummer behalten. Das ist sinnvoll, weil diese Nummer bereits auf Google, Website, Fahrzeug, Rechnung, Visitenkarte und in Kundendaten steht. Die KI bekommt deshalb meist eine eigene Zielnummer, waehrend die bekannte Nummer per Rufweiterleitung dorthin uebergibt.',
          'Der technische Schritt wirkt einfach: Nummer eintragen, Weiterleitung aktivieren, fertig. In der Praxis entstehen Probleme aber selten beim Eintragen der Nummer selbst. Sie entstehen, wenn niemand testet, wann die Weiterleitung greift, welche Nummer beim Agenten ankommt, ob der Agent zur Branche passt und ob Kalender oder Ticket wirklich funktionieren.',
        ],
      },
      {
        heading: 'Fehler 1: sofort weiterleiten, obwohl das Team noch ans Telefon soll',
        paragraphs: [
          'Eine sofortige Weiterleitung ist nur richtig, wenn wirklich jeder Anruf zuerst beim KI-Agenten landen soll. Viele Betriebe wollen aber nur einen Auffangmodus: bei Besetzt, nach einigen Sekunden, ausserhalb der Oeffnungszeiten oder wenn niemand abnimmt.',
          'Vor dem Aktivieren sollte deshalb klar sein, welcher Modus gewuenscht ist. Sonst beantwortet die KI ploetzlich Anrufe, die eigentlich noch beim Team landen sollten. Das ist kein KI-Problem, sondern eine falsch gesetzte Telefonregel.',
        ],
      },
      {
        heading: 'Fehler 2: kein echter Testanruf aus Kundensicht',
        paragraphs: [
          'Ein Test im Dashboard reicht nicht immer. Wichtig ist ein echter Anruf von einem normalen Telefon, so wie spaeter ein Kunde anruft. Dabei sollte man pruefen, ob der Agent richtig begruesst, ob er die Branche erkennt, ob er Unterbrechungen akzeptiert und ob er keine internen Tool-Namen ausspricht.',
          'Der Testanruf sollte auch einmal absichtlich schief laufen: Kunde nennt eine falsche E-Mail, korrigiert die Uhrzeit, fragt nach Datenschutz oder will abbrechen. Genau diese Faelle zeigen, ob der Agent robust genug fuer Live-Telefonie ist.',
        ],
      },
      {
        heading: 'Fehler 3: die falsche Zielnummer oder alte Agent-Version nutzen',
        paragraphs: [
          'Wenn ein Agent neu deployed wurde, koennen alte Testnummern, alte Retell-Agenten oder alte Weiterleitungsziele noch auf eine fruehere Konfiguration zeigen. Dann klingt der Agent anders als erwartet oder nutzt alte Tools.',
          'Vor dem Livegang sollte die aktuell hinterlegte Phonbot-Nummer mit dem Dashboard und dem letzten Agent-Deploy abgeglichen werden. Erst wenn der Testanruf wirklich den aktuellen Agenten erreicht, gehoert die Weiterleitung auf die Geschaeftsnummer.',
        ],
      },
      {
        heading: 'Fehler 4: Kalender und Tickets nicht mit der Weiterleitung testen',
        paragraphs: [
          'Ein Agent kann sprachlich gut wirken und trotzdem funktional unsicher sein. Entscheidend ist, ob er bei einem echten weitergeleiteten Anruf Termine nur nach freien Slots bucht, Absagen oder Verschiebungen korrekt behandelt und Tickets nicht doppelt anlegt.',
          'Wenn Kalender, Mitarbeiterkalender oder Rueckruf-Tickets verbunden sind, gehoeren sie in den Test. Der Agent darf nie behaupten, ein Termin sei gebucht, verschoben oder storniert, wenn das Tool keinen erfolgreichen Rueckgabewert geliefert hat.',
        ],
      },
      {
        heading: 'Fehler 5: Datenschutztext klingt richtig, passt aber nicht zur Einstellung',
        paragraphs: [
          'Der Agent sollte nicht mehr versprechen, als technisch eingestellt ist. Wenn Audio und Transkript nicht dauerhaft gespeichert werden, darf das klar gesagt werden. Wenn eine Aufzeichnung oder Auswertung aktiv ist, braucht der Anrufer eine passende Information und gegebenenfalls Einwilligung.',
          'Wichtig ist die Produktwahrheit: Einstellungen fuer Aufzeichnung, Transkript, Aufbewahrung und anonymisierte Muster muessen zum Prompt passen. Ein Datenschutzsatz, der gut klingt, aber nicht zur Konfiguration passt, ist gefaehrlicher als eine kurze ehrliche Erklaerung.',
        ],
      },
      {
        heading: 'Fehler 6: keine Rueckfallregel bei Stoerung',
        paragraphs: [
          'Telefonie, Kalender, KI-Modell und externe Tools koennen langsam antworten oder kurz ausfallen. Deshalb braucht der Agent einen ruhigen Rueckfallweg: Rueckruf aufnehmen, menschliche Uebergabe anbieten oder sagen, dass die Buchung gerade nicht bestaetigt werden kann.',
          'Schlecht ist eine Antwort wie "Das ist erledigt", wenn die Funktion nicht erfolgreich war. Gut ist: "Ich kann das gerade nicht sicher eintragen. Ich nehme Ihren Rueckrufwunsch auf und leite ihn weiter."',
        ],
      },
      {
        heading: 'Fehler 7: Minuten und Plan nicht zum echten Anrufvolumen pruefen',
        paragraphs: [
          'Der Nummer-Plan ist ein guenstiger Einstieg mit eigener KI-Telefonnummer und 70 Minuten pro Monat. Fuer echte operative Anrufannahme ist aber oft ein groesserer Plan sinnvoll, weil Testanrufe, echte Kundenfragen und laengere Buchungsdialoge Minuten verbrauchen.',
          'Vor dem Livegang sollte man grob schaetzen, wie viele Anrufe pro Woche realistisch sind. Wenn der Agent jeden Tag mehrere Gespraeche fuehren soll, ist Starter oder hoeher meist der praktischere Rahmen als nur eine technische Nummer.',
        ],
      },
    ],
    checklist: [
      'Aktuelle Phonbot-Zielnummer aus dem Dashboard kopieren und alte Testziele entfernen.',
      'Weiterleitungsart bewusst waehlen: sofort, bei Besetzt, nach Zeit oder ausserhalb der Oeffnungszeiten.',
      'Mindestens einen echten Testanruf von einem normalen Telefon machen.',
      'Im Test Terminbuchung, Terminverschiebung, Absage, Rueckruf und Fehlersituation pruefen.',
      'Prompt und Datenschutztext gegen die echten Speicher- und Aufzeichnungseinstellungen abgleichen.',
      'Rueckfallweg fuer Timeout, leeres Kalenderergebnis und Tool-Fehler definieren.',
      'Nach dem ersten Live-Anruf im Dashboard kontrollieren, ob Ticket, Kalender und Benachrichtigung stimmen.',
    ],
    faq: [
      ['Welche Rufweiterleitung ist fuer einen KI-Telefonassistenten am besten?', 'Das haengt vom Betrieb ab. Wenn die KI alle Anrufe annehmen soll, passt sofortige Weiterleitung. Wenn das Team zuerst rangehen soll, sind Weiterleitung bei Besetzt, nach Zeit oder ausserhalb der Oeffnungszeiten meist besser.'],
      ['Muss ich meine bestehende Telefonnummer ersetzen?', 'Nein. Meist bleibt die bestehende Nummer sichtbar und leitet technisch auf die Phonbot-Zielnummer weiter.'],
      ['Wie teste ich die Rufweiterleitung richtig?', 'Rufe von einem normalen Telefon die echte Geschaeftsnummer an, nicht nur die KI-Zielnummer. Pruefe Begruessung, Branche, Datenschutzhinweis, Kalender- oder Ticketfunktion und den Rueckfallweg bei Fehlern.'],
      ['Was soll der Agent sagen, wenn ein Tool nicht funktioniert?', 'Er sollte keine Aktion erfinden. Richtig ist eine kurze Erklaerung, dass die Eintragung gerade nicht sicher bestaetigt werden kann, plus Rueckruf oder menschliche Uebergabe.'],
    ],
    related: ['kontakt', 'branchen', 'selbststaendig'],
  },
  {
    slug: 'ki-anrufannahme-handwerker-notdienst-tickets',
    title: 'KI-Anrufannahme fuer Handwerker: Notdienst-Tickets statt Chaos',
    description: 'Wie Handwerksbetriebe Baustellenanrufe, Notdienst-Faelle und Rueckrufwuensche mit einem KI-Telefonassistenten sauber strukturieren.',
    headline: 'KI-Anrufannahme fuer Handwerker: aus Baustellenanrufen werden saubere Tickets.',
    datePublished: '2026-05-09',
    dateModified: TODAY,
    category: 'Branchen',
    readingMinutes: 7,
    primaryKeyword: 'KI Anrufannahme Handwerker',
    secondaryKeywords: ['KI Telefonassistent Handwerker', 'Notdienst Tickets automatisch', 'Baustellenanrufe strukturieren'],
    intent: 'Kaufnahe Informationsintention fuer Handwerksbetriebe, die Anrufe auf Baustellen, Notdienst-Faelle und Rueckrufwuensche verlaesslich erfassen wollen.',
    reviewedBy: 'Phonbot SEO/Superhirn',
    summary: 'Handwerksbetriebe brauchen keinen plaudernden Telefonbot, sondern eine robuste Anrufannahme: Anliegen erkennen, Dringlichkeit klaeren, Pflichtdaten sammeln, nichts erfinden und nur nach klaren Regeln weiterleiten oder ein Ticket anlegen.',
    sections: [
      {
        heading: 'Warum Handwerker am Telefon besonders viel verlieren',
        paragraphs: [
          'Auf der Baustelle ist ein Anruf selten bequem. Die Bohrmaschine laeuft, ein Kunde steht daneben, das Team ist unterwegs oder der Meister sitzt gerade im Auto. Trotzdem sind genau diese Anrufe oft wertvoll: Rohrbruch, Heizungsausfall, Rueckfrage zu einem Angebot, Terminverschiebung oder ein neuer Auftrag aus der Nachbarschaft.',
          'Ein klassischer Anrufbeantworter hilft nur begrenzt, weil viele Anrufer keine strukturierte Nachricht hinterlassen. Eine gute KI-Anrufannahme fuer Handwerker muss deshalb aktiv klaeren, worum es geht, welche Dringlichkeit vorliegt und welche Rueckmeldung der Betrieb geben soll. Sie ersetzt nicht die fachliche Entscheidung, aber sie verhindert, dass wichtige Informationen verloren gehen.',
        ],
      },
      {
        heading: 'Welche Daten ein Handwerker-Agent sicher sammeln sollte',
        bullets: [
          'Name, Rueckrufnummer und optional E-Mail fuer die weitere Abstimmung.',
          'Adresse oder Einsatzort, wenn es um Vor-Ort-Arbeit, Notdienst oder Besichtigung geht.',
          'Gewerk, Anliegen und kurze Problembeschreibung in normaler Kundensprache.',
          'Dringlichkeit: akuter Schaden, laufender Ausfall, Frist, Wunschzeit oder normale Anfrage.',
          'Vorhandene Kundennummer, Angebot oder Projektbezug, falls der Anrufer das nennen kann.',
          'Erlaubnis fuer Rueckruf oder Nachricht, falls der Betrieb per SMS oder E-Mail antwortet.',
        ],
      },
      {
        heading: 'Notdienst ist kein normales Formular',
        paragraphs: [
          'Bei Notdienst-Anrufen darf der Agent nicht so tun, als koenne er jede Situation selbst loesen. Er sollte Dringlichkeit erkennen, Basisdaten sichern und klar kommunizieren, dass ein Mensch oder der hinterlegte Notdienstprozess uebernimmt. Besonders wichtig sind Warnsignale wie Wasserschaden, Stromausfall, Heizungsausfall bei Kaelte, verschlossene Tuer oder ein Sicherheitsrisiko.',
          'Die saubere Regel lautet: Der Agent nimmt keine gefaehrlichen fachlichen Bewertungen vor, verspricht keine feste Einsatzzeit ohne Tool-Erfolg und erfindet keine Verfuegbarkeit. Wenn der Notdienst nicht erreichbar oder nicht konfiguriert ist, muss er das kurz sagen und einen Rueckruf oder eine alternative Eskalation vorbereiten.',
        ],
      },
      {
        heading: 'Wie aus einem Anruf ein brauchbares Ticket wird',
        paragraphs: [
          'Ein starkes Ticket ist kurz, aber entscheidungsfaehig. Es enthaelt den Anlass, den Standort, die Dringlichkeit, die Kontaktmethode und den naechsten Schritt. Fuer den Betrieb ist das viel wertvoller als ein langes Transkript, in dem die wichtigsten Details gesucht werden muessen.',
          'Phonbot kann genau dafuer konfiguriert werden: Der Agent fragt fehlende Pflichtdaten nach, bestaetigt kritische Angaben wie Telefonnummer, Adresse und Wunschzeit und legt erst dann ein Ticket oder einen Rueckrufwunsch an. Wenn Kalender oder Mitarbeiterverfuegbarkeit verbunden sind, darf er freie Zeiten nur aus dem Tool uebernehmen und muss bei leerem Ergebnis Alternativen anbieten.',
        ],
      },
      {
        heading: 'Typische Anrufarten im Handwerk',
        bullets: [
          'Neukunde fragt nach einem Angebot oder einer Besichtigung.',
          'Bestandskunde will einen Termin verschieben oder eine Rueckfrage stellen.',
          'Notdienst-Anruf mit hoher Dringlichkeit und unvollstaendigen Daten.',
          'Baustellenkunde fragt nach Ankunftszeit, Material oder Status.',
          'Lieferant, Partner oder Hausverwaltung moechte eine interne Nachricht hinterlassen.',
        ],
      },
      {
        heading: 'Grenzen: Was der Agent bewusst nicht machen sollte',
        paragraphs: [
          'Ein Handwerker-Agent sollte keine Preise fuer unbekannte Schaeden garantieren, keine Reparaturanleitung fuer riskante Situationen geben und keine Zusage machen, wenn Kalender, Ticket- oder Notdienst-Tool keinen Erfolg melden. Er sollte auch nicht personenbezogene Daten sammeln, die fuer den Zweck nicht gebraucht werden.',
          'Gerade fuer Voice ist Kuerze wichtig. Der Agent muss nicht jedes Detail der internen Logik erklaeren. Besser ist eine klare, ruhige Antwort: "Ich nehme das als dringenden Rueckruf auf. Ich habe Ihre Nummer und die Adresse, bitte bestaetigen Sie kurz noch einmal die Hausnummer." So bleibt der Anruf menschlich und trotzdem robust.',
        ],
      },
      {
        heading: 'So wird Phonbot fuer Handwerker sinnvoll eingesetzt',
        paragraphs: [
          'Im Phonbot-Dashboard werden Betrieb, Leistungen, Oeffnungszeiten, Mitarbeiter und Kalenderregeln gepflegt. Fuer Handwerksbetriebe ist besonders wichtig, dass Notdienst, normale Rueckrufe und Terminwunsch nicht vermischt werden. Ein guter Prompt trennt diese Faelle und entscheidet erst nach Pflichtdaten und Bestaetigung, ob gebucht, verschoben, storniert oder nur ein Ticket erstellt wird.',
          'Der groesste Nutzen entsteht nicht durch moeglichst viele Funktionen, sondern durch wenige stabile Regeln: Pflichtdaten sammeln, wichtige Angaben wiederholen, Tool-Ergebnisse nicht erfinden, bei Fehlern menschliche Uebergabe anbieten und doppelte Aktionen vermeiden. Dann wird KI-Anrufannahme nicht zur Spielerei, sondern zu einem verlaesslichen Teil des Betriebsablaufs.',
        ],
      },
    ],
    checklist: [
      'Notdienst, normale Anfrage und Rueckrufwunsch im Agent Builder klar trennen.',
      'Pflichtdaten fuer Adresse, Rueckrufnummer, Anliegen und Dringlichkeit festlegen.',
      'Kalender- oder Ticket-Tools nur nach vollstaendigen Daten und Bestaetigung nutzen.',
      'Fehlertexte fuer keine Verfuegbarkeit, Timeout und unklare Tool-Antworten definieren.',
      'Nach den ersten Testanrufen pruefen, ob Tickets kurz, eindeutig und handlungsfaehig sind.',
    ],
    faq: [
      ['Kann ein KI-Telefonassistent Notdienst-Anrufe fuer Handwerker annehmen?', 'Ja, wenn klare Regeln hinterlegt sind. Er sollte Dringlichkeit und Kontaktdaten erfassen, aber keine fachliche Gefahreneinschaetzung oder Einsatzzeit erfinden.'],
      ['Kann Phonbot aus Handwerker-Anrufen Tickets erstellen?', 'Ja. Der Agent kann strukturierte Rueckruf- oder Auftragstickets vorbereiten, wenn die benoetigten Daten gesammelt wurden und das jeweilige Tool erfolgreich antwortet.'],
      ['Darf der Agent Termine fuer Handwerker buchen oder verschieben?', 'Nur wenn Kalenderregeln, Pflichtdaten und ausdrueckliche Bestaetigung vorhanden sind. Ohne erfolgreiche Tool-Antwort darf er keinen Termin als gebucht, verschoben oder storniert darstellen.'],
    ],
    related: ['handwerker', 'branchen', 'kontakt'],
  },
  {
    slug: 'ki-telefonassistent-kosten-roi-kleine-unternehmen',
    title: 'KI-Telefonassistent Kosten: Wann lohnt sich Phonbot?',
    description: 'Was kleine Unternehmen bei Kosten, Minuten, verpassten Anrufen und Amortisation eines KI-Telefonassistenten realistisch rechnen sollten.',
    headline: 'KI-Telefonassistent Kosten: ab wann sich Phonbot rechnet.',
    datePublished: '2026-05-06',
    dateModified: TODAY,
    category: 'Kosten und ROI',
    readingMinutes: 7,
    primaryKeyword: 'KI Telefonassistent Kosten',
    secondaryKeywords: ['Voice Agent Kosten', 'Telefonassistent ROI', 'Phonbot Preise'],
    intent: 'Kaufnahe Informationsintention fuer kleine Unternehmen, die Kosten, Nutzen und Planwahl eines KI-Telefonassistenten bewerten wollen.',
    reviewedBy: 'Phonbot SEO/Superhirn',
    summary: 'Die Kostenfrage ist nicht nur der Monatspreis. Entscheidend ist, wie viele Anrufe sonst verloren gehen, wie viel Zeit das Team spart und ob der Agent echte Termine oder Rueckrufe erzeugt.',
    sections: [
      {
        heading: 'Warum der Monatspreis allein zu kurz greift',
        paragraphs: [
          'Viele Betriebe vergleichen einen KI-Telefonassistenten zuerst mit einer Telefonistin oder mit einem Anrufbeantworter. Beides greift zu kurz. Der echte Vergleich ist: Was kostet ein verpasster Anruf, wenn daraus ein Termin, ein Auftrag oder ein Rueckruf haette entstehen koennen?',
          'Gerade lokale Dienstleister bekommen Anrufe oft in den Momenten, in denen niemand abheben kann: waehrend einer Behandlung, auf der Baustelle, im Kundentermin oder ausserhalb der Oeffnungszeiten. Ein KI-Agent lohnt sich, wenn er diese Luecke schliesst und aus spontanen Anrufen strukturierte Chancen macht.',
        ],
      },
      {
        heading: 'Welche Kosten bei KI-Telefonie entstehen',
        bullets: [
          'Grundpreis fuer den gewaehlten Phonbot-Plan.',
          'Inklusive Minuten je nach Plan und moegliche Mehrminuten bei hoher Nutzung.',
          'Telefonnummer oder Rufweiterleitung von der bestehenden Geschaeftsnummer.',
          'Einrichtungszeit fuer Leistungen, Oeffnungszeiten, FAQ und Kalenderregeln.',
          'Interne Nachbearbeitung fuer Tickets, Rueckrufe oder komplexe Sonderfaelle.',
        ],
      },
      {
        heading: 'Eine einfache ROI-Rechnung fuer kleine Betriebe',
        paragraphs: [
          'Eine pragmatische Rechnung beginnt mit drei Zahlen: Wie viele Anrufe werden pro Woche verpasst? Wie viele davon sind potenzielle Kunden? Und wie viel ist ein gewonnener Termin oder Auftrag im Schnitt wert? Schon wenige gerettete Anfragen pro Monat koennen den Starter-Plan rechtfertigen, wenn der durchschnittliche Auftragswert nicht sehr niedrig ist.',
          'Beispiel: Wenn ein Salon oder Handwerksbetrieb nur zwei zusaetzliche zahlende Kunden im Monat gewinnt, kann der Nutzen hoeher sein als die laufenden Kosten. Noch nicht eingerechnet ist die Entlastung im Team, weil Standardfragen, Terminwuensche und Rueckrufnotizen nicht mehr nebenbei am Telefon sortiert werden muessen.',
        ],
      },
      {
        heading: 'Welcher Phonbot-Plan fuer welchen Fall passt',
        paragraphs: [
          'Der Nummer-Plan ab 8,99 EUR pro Monat ist der guenstige Einstieg fuer eine eigene KI-Telefonnummer und enthaelt 70 Minuten pro Monat. Fuer regelmaessige operative Telefonie mit mehr Volumen ist Starter oder hoeher der bessere Automatisierungsplan.',
          'Der Starter-Plan ab 89 EUR pro Monat passt fuer kleine Betriebe, die wirklich Anrufe annehmen, Termine vorbereiten oder buchen und Rueckruf-Tickets erzeugen wollen. Professional und Agency sind sinnvoll, wenn mehrere Agents, mehr Minuten oder mehrere Standorte gebraucht werden.',
        ],
      },
      {
        heading: 'Woran man erkennt, dass sich der Agent verbessert',
        paragraphs: [
          'Ein guter KI-Telefonassistent wird nicht einmal eingestellt und dann vergessen. Nach den ersten echten Anrufen sollten typische Fragen, Missverstaendnisse und Abbruchstellen ausgewertet werden. Daraus entstehen bessere FAQ, klarere Tool-Regeln und stabilere Antworten.',
          'Fuer SEO und Produktqualitaet ist genau dieser Praxisbezug wichtig: Phonbot sollte nicht versprechen, dass jeder Anruf automatisch Umsatz wird. Stark ist die ehrliche Aussage, dass der Agent erreichbar ist, Daten sauber sammelt, keine Tool-Ergebnisse erfindet und bei Unsicherheit einen Rueckruf vorbereitet.',
        ],
      },
    ],
    checklist: [
      'Verpasste Anrufe pro Woche realistisch schaetzen.',
      'Durchschnittlichen Wert eines Termins oder Auftrags notieren.',
      'Starter-Plan mit 300 Minuten pro Monat als operativen Standard pruefen.',
      'Nach dem ersten Monat Anrufgruende, Tickets und Buchungen auswerten.',
      'Prompt, FAQ und Kalenderregeln anhand echter Anrufe verbessern.',
    ],
    faq: [
      ['Was kostet ein KI-Telefonassistent bei Phonbot?', 'Der Einstieg mit eigener KI-Telefonnummer startet ab 8,99 EUR pro Monat. Fuer operative Anrufannahme mit 300 Minuten pro Monat startet der Starter-Plan bei 89 EUR pro Monat.'],
      ['Wann lohnt sich ein KI-Telefonassistent?', 'Wenn regelmaessig Anrufe verloren gehen, das Team unterbrochen wird oder Termine und Rueckrufe ausserhalb der Oeffnungszeiten entstehen.'],
      ['Ist der guenstigste Plan genug fuer mein Unternehmen?', 'Der Nummer-Plan ist gut fuer die technische Telefon-Anbindung. Fuer laufende Automatisierung, Termine und echten Tagesbetrieb ist Starter oder hoeher meist passender.'],
    ],
    related: ['branchen', 'selbststaendig', 'kontakt'],
  },
  {
    slug: 'ki-telefonassistent-friseur-terminbuchung',
    title: 'KI-Telefonassistent fuer Friseure: Termine automatisch buchen | Phonbot',
    description: 'Wie Friseursalons mit einem KI-Telefonassistenten Terminanfragen, Wunschfriseur, Leistungen und Rueckrufe strukturiert aufnehmen.',
    headline: 'KI-Telefonassistent fuer Friseure: wann er hilft und wo die Grenze liegt.',
    datePublished: '2026-05-05',
    dateModified: TODAY,
    category: 'Branchen',
    readingMinutes: 6,
    primaryKeyword: 'KI Telefonassistent Friseur',
    secondaryKeywords: ['Telefonassistent Friseursalon', 'automatische Terminbuchung Salon', 'KI Anrufannahme Friseur'],
    intent: 'Kauf- und Informationsintention fuer Saloninhaber, die Terminanrufe automatisieren wollen.',
    reviewedBy: 'Phonbot SEO/Superhirn',
    summary: 'Ein guter Salon-Agent nimmt nicht nur Namen auf. Er muss Leistung, Dauer, Wunschfriseur, Neukundenstatus und Kalenderverfuegbarkeit sauber zusammenbringen.',
    sections: [
      {
        heading: 'Warum Salons besonders stark vom Telefon abhaengen',
        paragraphs: [
          'Friseursalons verlieren Anfragen oft nicht, weil niemand Termine vergeben will, sondern weil der beste Zeitpunkt fuer einen Kundenanruf genau in eine Behandlung faellt. Beim Schneiden, Faerben oder Foehnen ist das Telefon stoerend, gleichzeitig kann ein verpasster Anruf direkt zu einem anderen Salon wechseln.',
          'Ein KI-Telefonassistent lohnt sich deshalb vor allem fuer wiederkehrende Standardanfragen: Haarschnitt, Farbe, Beratung, Oeffnungszeiten, Preise, Absage, Verschiebung und Rueckruf. Die Aufgabe ist nicht, den Salon menschlich zu ersetzen, sondern die Luecke zwischen Anruf und Rueckmeldung zu schliessen.',
        ],
      },
      {
        heading: 'Welche Daten der Agent vor einer Buchung braucht',
        bullets: [
          'Name und Rueckrufnummer des Kunden.',
          'Leistung, grobe Dauer und besondere Hinweise wie Farbe, Balayage oder Beratung.',
          'Wunschdatum, Uhrzeit und optional Wunschfriseur.',
          'Bestandskunde oder Neukunde, falls das Kundenmodul aktiv ist.',
          'Ausdrueckliche Bestaetigung des Termins, bevor der Kalender beschrieben wird.',
        ],
      },
      {
        heading: 'Was ein guter Friseur-Agent niemals tun sollte',
        paragraphs: [
          'Der Agent darf keinen Termin erfinden, wenn der Kalender keine freie Zeit liefert. Er darf auch nicht behaupten, etwas sei gebucht, solange das Tool keine erfolgreiche Antwort gegeben hat. Gerade bei Mitarbeiterkalendern ist es wichtig, nicht einfach einen allgemeinen Salon-Slot zu nehmen, wenn eigentlich eine bestimmte Person gewuenscht wurde.',
          'Bei komplexen Farb- oder Chemiefragen sollte der Agent nicht beraten. Besser ist eine kurze Einordnung: Er nimmt Vorbehandlung, Allergie- oder Kopfhaut-Hinweise auf und erstellt ein Rueckruf- oder Beratungsticket.',
        ],
      },
      {
        heading: 'So passt Phonbot in den Salon-Alltag',
        paragraphs: [
          'Phonbot fragt strukturiert nach Leistung, Terminwunsch und Kontakt. Wenn ein Kalender verbunden ist, prueft der Agent freie Slots und bestaetigt erst nach erfolgreicher Buchung. Wenn kein Slot passt, wird kein falscher Termin versprochen, sondern ein Rueckruf oder eine Wartelistenanfrage vorbereitet.',
          'Der Starter-Plan ab 89 EUR pro Monat ist der realistische Einstieg fuer vollstaendige Terminbuchung. Der Nummer-Plan ab 8,99 EUR pro Monat ist prima fuer eine eigene KI-Telefonnummer, aber nicht der vollstaendige Salon-Automatisierungsplan.',
        ],
      },
    ],
    checklist: [
      'Leistungen mit Dauer im Agent Builder pflegen.',
      'Kalender pro Mitarbeiter verbinden, wenn Wunschfriseur wichtig ist.',
      'Klare Regeln fuer Farbberatung und sensible Hinweise setzen.',
      'Rueckruf-Tickets fuer unklare oder riskante Faelle aktivieren.',
      'Nach den ersten echten Anrufen Prompt und FAQ nachschaerfen.',
    ],
    faq: [
      ['Kann ein KI-Telefonassistent Friseurtermine direkt buchen?', 'Ja, wenn ein Kalender verbunden ist und alle Pflichtdaten vorliegen. Der Agent sollte erst nach Nutzerbestaetigung und erfolgreicher Tool-Antwort zusagen.'],
      ['Kann der Agent mehrere Mitarbeiter unterscheiden?', 'Ja. Dafuer muessen Mitarbeiter, Leistungen und Kalender sauber hinterlegt sein.'],
      ['Ist ein KI-Agent fuer Farbberatung geeignet?', 'Nur begrenzt. Er kann Hinweise aufnehmen und Beratungstermine vorbereiten, aber keine individuelle fachliche Bewertung ersetzen.'],
    ],
    related: ['friseur', 'branchen'],
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
    intent: 'Informations- und Kaufhuerde fuer Betriebe, die KI-Telefonie rechtssicher einsetzen wollen.',
    reviewedBy: 'Phonbot SEO/Superhirn',
    summary: 'Datenschutz ist bei Voice Agents kein Footer-Thema. Die wichtigsten Entscheidungen betreffen Einwilligung, Speicherfristen, Aufzeichnung, Transkript und Anbietergrenzen.',
    sections: [
      {
        heading: 'Warum Datenschutz bei Telefonie besonders sensibel ist',
        paragraphs: [
          'Telefonate enthalten schnell personenbezogene Daten: Name, Telefonnummer, Terminwunsch, Adresse, Anliegen oder interne Rueckrufnotizen. Bei manchen Branchen kommen besondere Kategorien oder vertrauliche Informationen hinzu. Deshalb braucht ein KI-Telefonassistent klare Regeln, bevor er live geht.',
          'Wichtig ist die Trennung zwischen Anrufmetadaten, Transkript, Audio und daraus abgeleiteten Mustern. Nicht jede technische Moeglichkeit ist automatisch sinnvoll oder erforderlich.',
        ],
      },
      {
        heading: 'Welche Entscheidungen vor dem Deploy fallen sollten',
        bullets: [
          'Soll Audio gespeichert werden oder nur fuer den Live-Call verarbeitet werden?',
          'Soll ein Transkript gespeichert werden, und wenn ja, wie lange?',
          'Welche Metadaten sind fuer Abrechnung und Support noetig?',
          'Welche Subprozessoren werden fuer Telefonie, KI, Kalender und E-Mail eingesetzt?',
          'Welche Branchen oder Anliegen sind ausgeschlossen, weil sie zu sensibel sind?',
        ],
      },
      {
        heading: 'Einwilligung und klare Kommunikation',
        paragraphs: [
          'Der Agent sollte frueh und knapp sagen, dass es sich um einen KI-Assistenten handelt und welche Daten verarbeitet werden. Wenn Aufzeichnung oder Transkript gespeichert werden, muss der Nutzer verstehen, wozu das passiert. Lehnt der Anrufer eine optionale Aufzeichnung ab, sollte der Agent nicht automatisch auflegen, sondern mit datensparsamer Verarbeitung weiterhelfen, sofern der konkrete Zweck das erlaubt.',
          'Kritisch sind Formulierungen wie "alles DSGVO-konform" ohne Kontext. Besser ist konkrete Wahrheit: AVV verfuegbar, Speicherfristen einstellbar, Subprozessoren transparent, Audio optional, Metadaten fuer Abrechnung noetig.',
        ],
      },
      {
        heading: 'Wie Phonbot damit umgehen sollte',
        paragraphs: [
          'Phonbot sollte sichere Defaults nutzen: keine unnoetige Speicherung, klare Retention, transparente Subprozessoren und sichtbare AVV-/Datenschutz-Seiten. Fuer anonymisierte Pattern darf nur gearbeitet werden, wenn personenbezogene Daten vorher entfernt werden und der Kunde bewusst zugestimmt hat.',
          'Die beste SEO-Wirkung entsteht hier nicht durch juristische Schlagworte, sondern durch konkrete Antworten auf echte Kaufhuerden: Was wird gespeichert? Wie lange? Wer verarbeitet Daten? Was passiert bei Widerruf? Was bleibt fuer Abrechnung noetig?',
        ],
      },
    ],
    checklist: [
      'KI-Hinweis im Prompt aktivieren.',
      'Audio- und Transkript-Speicherung bewusst konfigurieren.',
      'Speicherfristen je Kunde dokumentieren.',
      'AVV, Datenschutz und Subprozessoren verlinken.',
      'Sensible Branchen mit klaren Grenzen versehen.',
    ],
    faq: [
      ['Muss ein KI-Telefonassistent immer aufzeichnen?', 'Nein. Ein Voice Agent kann je nach Setup auch ohne dauerhafte Audio- oder Transkriptspeicherung betrieben werden.'],
      ['Was muss der Anrufer wissen?', 'Er sollte erkennen, dass er mit einem KI-Assistenten spricht und welche Daten fuer welchen Zweck verarbeitet werden.'],
      ['Sind Anrufmetadaten dasselbe wie Transkripte?', 'Nein. Metadaten wie Datum, Dauer und Rufnummer sind etwas anderes als Audio oder vollstaendige Gespraechsinhalte.'],
    ],
    related: ['datenschutz', 'avv', 'sub-processors'],
  },
  {
    slug: 'rufweiterleitung-ki-telefonnummer',
    title: 'Rufweiterleitung zur KI-Telefonnummer: bestehende Nummer behalten | Phonbot',
    description: 'Wie kleine Unternehmen ihre bestehende Nummer behalten und Anrufe per Rufweiterleitung an einen KI-Telefonassistenten uebergeben.',
    headline: 'Rufweiterleitung zur KI-Telefonnummer: kein Nummernwechsel noetig.',
    datePublished: '2026-05-05',
    dateModified: TODAY,
    category: 'Telefonie',
    readingMinutes: 5,
    primaryKeyword: 'Rufweiterleitung KI Telefonnummer',
    secondaryKeywords: ['bestehende Nummer KI Telefonassistent', 'Telefonnummer weiterleiten Voice Bot', 'KI Anrufannahme Rufumleitung'],
    intent: 'Praktische Setup-Frage fuer Betriebe, die ihre bestehende Telefonnummer behalten wollen.',
    reviewedBy: 'Phonbot SEO/Superhirn',
    summary: 'Viele Betriebe wollen keine neue Nummer bewerben. Mit Rufweiterleitung kann die bestehende Nummer bleiben, waehrend der KI-Agent Anrufe annimmt.',
    sections: [
      {
        heading: 'Warum die bestehende Nummer bleiben sollte',
        paragraphs: [
          'Eine Geschaeftsnummer steht auf Website, Google Business Profile, Fahrzeugen, Visitenkarten, Rechnungen und alten Kundendaten. Ein Nummernwechsel erzeugt Reibung. Fuer kleine Betriebe ist es daher meist besser, die gewohnte Nummer zu behalten und Anrufe technisch weiterzuleiten.',
          'Der KI-Telefonassistent bekommt dafuer eine eigene Zielnummer. Die alte Nummer bleibt sichtbar, waehrend eingehende Anrufe je nach Regel direkt, bei Besetzt oder nach Zeitablauf an die KI-Nummer gehen.',
        ],
      },
      {
        heading: 'Welche Weiterleitungsarten sinnvoll sind',
        bullets: [
          'Sofortige Weiterleitung: Alle Anrufe gehen direkt zum KI-Agenten.',
          'Weiterleitung bei Besetzt: Der Agent springt ein, wenn das Team telefoniert.',
          'Weiterleitung nach Zeit: Erst klingelt das Team, danach uebernimmt der Agent.',
          'Weiterleitung ausserhalb der Oeffnungszeiten: Tagsueber Team, abends KI-Agent.',
        ],
      },
      {
        heading: 'Was vor dem Aktivieren getestet werden sollte',
        paragraphs: [
          'Vor dem Live-Schalten sollte ein Testanruf aus Kundensicht erfolgen. Wichtig sind Begruessung, KI-Hinweis, korrekte Branche, Rufnummernanzeige, Ticket- oder Kalenderfunktion und die Frage, ob der Agent bei Unsicherheit sauber einen Rueckruf anbietet.',
          'Auch die Minutenlogik gehoert dazu. Der Nummer-Plan enthaelt 70 Minuten pro Monat. Fuer regelmaessige monatliche Telefonie mit vielen Anrufen ist Starter oder hoeher der bessere operative Plan.',
        ],
      },
      {
        heading: 'Wie Phonbot den Ablauf abbildet',
        paragraphs: [
          'Phonbot stellt eine deutsche Festnetznummer bereit. Im Dashboard kann der Betrieb den Agenten konfigurieren, Testanrufe machen und anschliessend die bestehende Nummer beim eigenen Anbieter weiterleiten.',
          'Damit kein Anruf im Nirgendwo landet, sollte die Weiterleitung erst nach einem erfolgreichen Test aktiviert werden. Bei Problemen gehoeren klare Fehlertexte und Rueckfalloptionen in den Setup-Flow.',
        ],
      },
    ],
    checklist: [
      'Phonbot-Nummer bereitstellen.',
      'Agent mit Branche, Oeffnungszeiten und Services deployen.',
      'Testanruf machen und Tool-Funktionen pruefen.',
      'Rufweiterleitung beim Anbieter aktivieren.',
      'Nach dem ersten echten Anruf Ticket, Kalender und Benachrichtigung kontrollieren.',
    ],
    faq: [
      ['Muss ich meine alte Telefonnummer ersetzen?', 'Nein. In den meisten Faellen reicht eine Rufweiterleitung auf die Phonbot-Nummer.'],
      ['Kann der Agent nur ausserhalb der Oeffnungszeiten rangehen?', 'Ja, wenn die Weiterleitung oder Telefonie-Regel entsprechend eingerichtet ist.'],
      ['Was kostet die eigene KI-Nummer?', 'Der Nummer-Plan startet bei 8,99 EUR pro Monat und enthaelt 70 Minuten pro Monat.'],
    ],
    related: ['kontakt', 'branchen'],
  },
];

export function blogUrl(post) {
  return `${SITE}/blog/${post.slug}/`;
}
