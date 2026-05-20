export const END_CALL_LAST_TURN_BLOCKER =
  'Der letzte Nutzer-Turn gewinnt: Wenn der letzte Nutzer-Turn eine Frage, Korrektur, Unterbrechung, Kritik, ein neues Anliegen, ein unklares Ja/Okay, ein Fortsetzungssignal wie "warte/moment/was?" oder Unsicherheit enthaelt, ist end_call gesperrt. Antworte auf den Inhalt oder frage kurz nach; sage nicht Tschuess und lege nicht auf.';

export const END_CALL_POSITIVE_CASES = [
  'Der letzte Nutzer-Turn ist eindeutig final: echte Verabschiedung oder Abschlusswunsch ohne neue Frage, Korrektur, Unsicherheit oder neues Anliegen.',
  'Der Nutzer bittet ausdruecklich ums Auflegen oder Beenden.',
  'Du hast bereits final verabschiedet und es kommt kurz keine verwertbare neue Nutzerreaktion.',
  'Eine konfigurierte Hangup-Regel trifft eindeutig zu.',
] as const;

const INBOUND_END_CALL_TOOL_DESCRIPTION_BASE =
  [
    'End the call only after a clear positive end condition:',
    'the caller clearly says goodbye or asks to hang up;',
    'all open tasks are complete, you asked whether anything else is needed, and the caller clearly declines;',
    'you already gave the final goodbye and no new caller content follows;',
    'a configured hangup/spam rule clearly applies.',
    'Do not end only because recording was declined.',
    END_CALL_LAST_TURN_BLOCKER,
  ].join(' ');

export function buildInboundEndCallToolDescription(recordingDeclineToolAvailable: boolean): string {
  if (!recordingDeclineToolAvailable) return INBOUND_END_CALL_TOOL_DESCRIPTION_BASE;
  return [
    INBOUND_END_CALL_TOOL_DESCRIPTION_BASE,
    'For normal inbound calls, if the caller refuses audio/transcript storage, call recording_declined and continue helping unless the caller also wants to end.',
  ].join(' ');
}

export const DEMO_END_CALL_TOOL_DESCRIPTION =
  [
    'Beende den Website-Demo-Anruf nur in einem positiven Endfall:',
    'der letzte Nutzer-Turn ist eindeutig final, z.B. "tschuess", "ciao", "danke das wars", "auf wiederhoeren", "nein danke", "alles gut" oder "das war alles";',
    'der Nutzer bittet ausdruecklich ums Auflegen;',
    'du hast einen Demo-Termin sauber simuliert aufgenommen, "Kann ich noch etwas fuer dich tun?" gefragt, den Testlink genau einmal angeboten oder die Ablehnung akzeptiert, final einen schoenen Tag gewuenscht und danach kommt eine Verabschiedung oder kurze Stille;',
    'du hast ausdruecklich gesagt: "Ich simuliere die Weiterleitung jetzt und beende die Demo";',
    'oder recording_declined war erfolgreich und du musst die Demo wegen Audio-/Transkript-Widerruf beenden.',
    'Nicht direkt nach Terminwunsch, Buchungsbestaetigung, Testlink-Angebot, "okay", "ja", "was", "hallo", Unterbrechung, Frage, Korrektur oder neuem Anliegen beenden.',
    END_CALL_LAST_TURN_BLOCKER,
  ].join(' ');

export const SALES_END_CALL_TOOL_DESCRIPTION =
  [
    'Beende den Sales-Callback nur in einem positiven Endfall:',
    'der Angerufene verabschiedet sich eindeutig oder bittet ums Auflegen;',
    'der Angerufene sagt klar kein Interesse, nicht mehr anrufen, keine Werbung oder widerspricht weiterem Kontakt;',
    'recording_declined war erfolgreich und der Sales-/Demo-Callback muss beendet werden;',
    'der naechste Schritt ist bestaetigt oder der Testlink wurde genannt/versendet soweit bestaetigt, du hast gefragt ob noch etwas offen ist, und es gibt kein offenes Anliegen mehr;',
    'oder der Anruf passt gerade nicht und ein spaeterer Kontakt/Testlink wurde vom Angerufenen bestaetigt oder klar abgelehnt. Nicht beenden, solange dein Rueckruf-/Testlink-Angebot noch als offene Frage im Raum steht.',
    'Kein weiteres Nachhaken bei Opt-out oder klarem Nein.',
    END_CALL_LAST_TURN_BLOCKER,
  ].join(' ');

export const PLATFORM_END_CALL_POLICY = `## Beenden des Gespraechs
Nutze end_call nur nach einem klar positiven Gespraechsende:
- Der Anrufer verabschiedet sich eindeutig ("tschuess", "ciao", "danke das war's", "auf wiederhoeren", "bye", "schoenen Tag", "alles gut", "das war alles", "nein danke"). Verabschiede dich knapp und rufe end_call direkt danach auf.
- Der Anrufer bittet ausdruecklich ums Beenden ("leg auf", "beende den Anruf", "ich muss los"). Kurz bestaetigen, knapp verabschieden, end_call aufrufen.
- Alle offenen Aufgaben sind erledigt, du hast gefragt ob noch etwas offen ist, und der Anrufer verneint eindeutig. Dann final verabschieden und end_call aufrufen.
- Du hast dich final verabschiedet und innerhalb weniger Sekunden kommt keine neue verwertbare Nutzerreaktion. Dann end_call aufrufen; nicht nochmal fragen.
- Eine konfigurierte Hangup-/Spam-Regel greift eindeutig.
- Wenn du eine echte Weiterleitung mit transfer_call ausfuehren kannst, kuendige sie kurz an und nutze transfer_call. Wenn nur end_call fuer eine simulierte/extern angekuendigte Weiterleitung vorgesehen ist, darf end_call erst nach dieser klaren Ansage kommen.

${END_CALL_LAST_TURN_BLOCKER}

Recording-Widerspruch ist mode-abhaengig: Bei normalen Inbound-Agenten die verfuegbare Datenschutz-/Widerspruchsfunktion nutzen, falls sie im Tool-Set vorhanden ist, und weiterhelfen, wenn der Anrufer weiter Hilfe will. Bei Demo- oder Sales-Demo-Calls darf nach erfolgreich verarbeitetem Widerspruch beendet werden, wenn die jeweiligen Demo/Sales-Regeln das verlangen.`;

const AGENT_INSTRUCTIONS_END_CALL_POLICY_BASE = `## Gespraechsende - klare positive Gebote
- end_call nur nach einem klaren positiven Endfall nutzen: eindeutige Verabschiedung, ausdruecklicher Wunsch aufzulegen, erledigte Aufgabe plus verneinte Abschlussfrage, finale Verabschiedung plus kurze Stille, oder eindeutig passende Hangup-/Spam-Regel.
- Bei "tschuess", "danke, das war's", "bis dann", "auf Wiederhoeren", "alles gut", "nein danke" kurz zurueckgruessen und end_call aufrufen.
- Nach eigener finaler Verabschiedung und ca. 5 Sekunden ohne verwertbare neue Nutzerreaktion end_call aufrufen. Nicht erneut nachfragen.
- Bei neuem Anliegen, Frage, Korrektur, "warte", "moment", "was?", "ja aber" oder unklarem "okay/ja" nicht auflegen; Inhalt aufgreifen oder nachfragen.
- Bei Spam/Werbeanrufen oder konfigurierter Hangup-Regel: knapp finaler Satz, dann end_call.`;

export function buildAgentInstructionsEndCallPolicy(recordingDeclineToolAvailable: boolean): string {
  if (!recordingDeclineToolAvailable) return AGENT_INSTRUCTIONS_END_CALL_POLICY_BASE;
  return `${AGENT_INSTRUCTIONS_END_CALL_POLICY_BASE}
- Bei Recording-Widerspruch im normalen Kunden-Agenten: recording_declined aufrufen und weiterhelfen, wenn der Anrufer weiter Hilfe will. Nicht nur deshalb auflegen.`;
}
