import React, { useEffect, useRef } from 'react';

type LegalPage = 'impressum' | 'datenschutz' | 'agb';

type Props = {
  page: LegalPage;
  onClose: () => void;
};

const TITLES: Record<LegalPage, string> = {
  impressum: 'Impressum',
  datenschutz: 'Datenschutzerklärung',
  agb: 'Allgemeine Geschäftsbedingungen',
};

function ImpressumContent() {
  return (
    <div className="space-y-6 text-white/80 text-sm leading-relaxed">
      <section>
        <h2 className="text-base font-semibold text-white mb-2">Angaben gemäß § 5 TMG</h2>
        <p>
          Hans Ulrich Waier (Einzelunternehmer)<br />
          Scharnhorststraße 8<br />
          12307 Berlin<br />
          Deutschland
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white mb-2">Vertreten durch</h2>
        <p>
          Inhaber: Hans Ulrich Waier
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white mb-2">Kontakt</h2>
        <p>
          Telefon: +49 30 75937169<br />
          E-Mail: info@phonbot.de<br />
          Web: <a href="https://phonbot.de" className="text-orange-400 hover:text-orange-300 underline">phonbot.de</a>
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white mb-2">Rechtsform &amp; Registereintrag</h2>
        <p>
          Einzelunternehmen (Kleingewerbe gemäß § 14 GewO).<br />
          Kein Handelsregistereintrag — Eintragung erfolgt erst bei späterer Umwandlung in eine
          UG (haftungsbeschränkt) bzw. GmbH.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white mb-2">Umsatzsteuer</h2>
        <p>
          Kleinunternehmer-Regelung gemäß § 19 UStG: Es wird keine Umsatzsteuer berechnet, daher
          liegt keine Umsatzsteuer-Identifikationsnummer (USt-IdNr.) vor.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white mb-2">
          Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV
        </h2>
        <p>
          Hans Ulrich Waier<br />
          Scharnhorststraße 8, 12307 Berlin
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white mb-2">Produktportfolio</h2>
        <p>
          Phonbot ist ein Produkt von Hans Ulrich Waier (Einzelunternehmer). Weitere geplante
          Produkte unter dem Mindrails-Banner: Sozibot, Kanzleibot — alle aktuell als
          Einzelunternehmer-Tätigkeit.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white mb-2">Streitschlichtung</h2>
        <p>
          Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS) bereit:{' '}
          <a
            href="https://ec.europa.eu/consumers/odr/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-orange-400 hover:text-orange-300 underline"
          >
            https://ec.europa.eu/consumers/odr/
          </a>
          . Unsere E-Mail-Adresse finden Sie oben im Impressum.
        </p>
        <p className="mt-2">
          Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer
          Verbraucherschlichtungsstelle teilzunehmen.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white mb-2">Haftung für Inhalte</h2>
        <p>
          Als Diensteanbieter sind wir gemäß § 7 Abs. 1 TMG für eigene Inhalte auf diesen Seiten nach
          den allgemeinen Gesetzen verantwortlich. Nach §§ 8 bis 10 TMG sind wir als Diensteanbieter
          jedoch nicht verpflichtet, übermittelte oder gespeicherte fremde Informationen zu überwachen
          oder nach Umständen zu forschen, die auf eine rechtswidrige Tätigkeit hinweisen.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white mb-2">Haftung für Links</h2>
        <p>
          Unser Angebot enthält Links zu externen Websites Dritter, auf deren Inhalte wir keinen
          Einfluss haben. Deshalb können wir für diese fremden Inhalte auch keine Gewähr übernehmen.
          Für die Inhalte der verlinkten Seiten ist stets der jeweilige Anbieter oder Betreiber der
          Seiten verantwortlich.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white mb-2">Urheberrecht</h2>
        <p>
          Die durch die Seitenbetreiber erstellten Inhalte und Werke auf diesen Seiten unterliegen dem
          deutschen Urheberrecht. Die Vervielfältigung, Bearbeitung, Verbreitung und jede Art der
          Verwertung außerhalb der Grenzen des Urheberrechtes bedürfen der schriftlichen Zustimmung des
          jeweiligen Autors bzw. Erstellers.
        </p>
      </section>
    </div>
  );
}

function DatenschutzContent() {
  return (
    <div className="space-y-6 text-white/80 text-sm leading-relaxed">
      <section>
        <h2 className="text-base font-semibold text-white mb-2">1. Verantwortlicher</h2>
        <p>
          Verantwortlicher im Sinne der DSGVO ist:<br />
          Hans Ulrich Waier (Einzelunternehmer)<br />
          Scharnhorststraße 8, 12307 Berlin<br />
          E-Mail: info@phonbot.de
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white mb-2">2. Datenerfassung auf dieser Website</h2>

        <h3 className="text-sm font-semibold text-white/90 mt-3 mb-1">Server-Log-Dateien</h3>
        <p>
          Der Provider dieser Website erhebt und speichert automatisch Informationen in sogenannten
          Server-Log-Dateien, die Ihr Browser automatisch an uns übermittelt. Dies sind: Browsertyp und
          -version, verwendetes Betriebssystem, Referrer-URL, Hostname des zugreifenden Rechners,
          Uhrzeit der Serveranfrage und IP-Adresse. Diese Daten sind nicht bestimmten Personen
          zuordenbar. Eine Zusammenführung dieser Daten mit anderen Datenquellen wird nicht vorgenommen.
          Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse am sicheren Betrieb).
        </p>

        <h3 className="text-sm font-semibold text-white/90 mt-3 mb-1">Cookies</h3>
        <p>
          Wir verwenden ausschließlich technisch notwendige Cookies, die für den Betrieb der Website
          erforderlich sind. Diese Cookies speichern keine personenbezogenen Daten und werden nicht zur
          Verfolgung von Nutzern über verschiedene Websites hinweg verwendet. Eine Einwilligung gemäß
          Art. 6 Abs. 1 lit. a DSGVO ist für technisch notwendige Cookies nicht erforderlich.
          Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO.
        </p>

        <h3 className="text-sm font-semibold text-white/90 mt-3 mb-1">Kontaktformular und Registrierung</h3>
        <p>
          Wenn Sie uns per Kontaktformular Anfragen zukommen lassen oder ein Konto erstellen, werden
          Ihre Angaben aus dem Anfrageformular inklusive der von Ihnen angegebenen Kontaktdaten zwecks
          Bearbeitung der Anfrage und für den Fall von Anschlussfragen bei uns gespeichert. Diese Daten
          geben wir nicht ohne Ihre Einwilligung weiter. Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO
          (Vertragserfüllung) bzw. Art. 6 Abs. 1 lit. a DSGVO (Einwilligung).
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white mb-2">3. Rechte der betroffenen Personen</h2>
        <p>Sie haben gegenüber uns folgende Rechte hinsichtlich Ihrer personenbezogenen Daten:</p>
        <ul className="list-disc list-inside space-y-1 mt-2">
          <li>
            <span className="font-medium text-white/90">Auskunftsrecht</span> (Art. 15 DSGVO): Sie
            haben das Recht, eine Bestätigung darüber zu verlangen, ob Sie betreffende personenbezogene
            Daten verarbeitet werden.
          </li>
          <li>
            <span className="font-medium text-white/90">Recht auf Berichtigung</span> (Art. 16 DSGVO):
            Sie haben das Recht, die Berichtigung unrichtiger Daten zu verlangen.
          </li>
          <li>
            <span className="font-medium text-white/90">Recht auf Löschung</span> (Art. 17 DSGVO): Sie
            haben das Recht, die Löschung Ihrer personenbezogenen Daten zu verlangen, sofern keine
            gesetzlichen Aufbewahrungspflichten entgegenstehen.
          </li>
          <li>
            <span className="font-medium text-white/90">Recht auf Einschränkung</span> (Art. 18 DSGVO):
            Sie haben das Recht, die Einschränkung der Verarbeitung Ihrer Daten zu verlangen.
          </li>
          <li>
            <span className="font-medium text-white/90">Recht auf Datenportabilität</span> (Art. 20
            DSGVO): Sie haben das Recht, Ihre Daten in einem strukturierten, maschinenlesbaren Format zu
            erhalten.
          </li>
          <li>
            <span className="font-medium text-white/90">Widerspruchsrecht</span> (Art. 21 DSGVO): Sie
            haben das Recht, der Verarbeitung Ihrer personenbezogenen Daten zu widersprechen, sofern
            die Verarbeitung auf Art. 6 Abs. 1 lit. e oder f DSGVO beruht.
          </li>
          <li>
            <span className="font-medium text-white/90">Beschwerderecht</span>: Sie haben das Recht,
            sich bei einer Datenschutz-Aufsichtsbehörde über die Verarbeitung Ihrer Daten zu beschweren.
          </li>
        </ul>
        <p className="mt-3">
          Zur Ausübung Ihrer Rechte wenden Sie sich bitte an: info@phonbot.de
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white mb-2">4. Auftragsverarbeitung / Drittanbieter</h2>
        <p>
          Zur Erbringung unserer Leistungen setzen wir folgende Auftragsverarbeiter ein, mit denen wir
          Auftragsverarbeitungsverträge gemäß Art. 28 DSGVO abgeschlossen haben:
        </p>

        <h3 className="text-sm font-semibold text-white/90 mt-3 mb-1">Stripe (Zahlungsabwicklung)</h3>
        <p>
          Für die Zahlungsabwicklung verwenden wir Stripe Payments Europe, Ltd., 1 Grand Canal Street
          Lower, Grand Canal Dock, Dublin, D02 H210, Irland. Stripe verarbeitet Zahlungsdaten gemäß
          seinen Datenschutzrichtlinien (stripe.com/de/privacy). Rechtsgrundlage: Art. 6 Abs. 1 lit. b
          DSGVO.
        </p>

        <h3 className="text-sm font-semibold text-white/90 mt-3 mb-1">Resend (E-Mail-Versand)</h3>
        <p>
          Für den transaktionalen E-Mail-Versand (z. B. Bestätigungs- und Benachrichtigungs-E-Mails)
          verwenden wir Resend Inc. Dabei werden E-Mail-Adresse und Versandmetadaten übermittelt.
          Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO.
        </p>

        <h3 className="text-sm font-semibold text-white/90 mt-3 mb-1">Retell AI (KI-Telefonie)</h3>
        <p>
          Für die KI-gestützte Sprachverarbeitung von Telefonanrufen verwenden wir Retell AI Inc., USA.
          Bei Telefonanrufen werden Sprachdaten (Audio, Transkript, Metadaten wie Nummer und Anrufdauer)
          zur Verarbeitung übertragen. Nutzer werden zu Beginn eines Anrufs auf die Aufzeichnung
          hingewiesen (§ 201 StGB). Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO bzw. Art. 6 Abs. 1 lit.
          a DSGVO. Datenübermittlung in die USA auf Basis der EU-Standardvertragsklauseln
          (Art. 46 Abs. 2 lit. c DSGVO) sowie des EU-US Data Privacy Framework, sofern der Anbieter
          zertifiziert ist.
        </p>

        <h3 className="text-sm font-semibold text-white/90 mt-3 mb-1">Demo-Anrufe auf phonbot.de</h3>
        <p>
          Wenn Sie auf phonbot.de die Live-Demo eines KI-Telefonassistenten nutzen (Web-Anruf direkt
          im Browser), wird das Gesprächs-Transkript zusammen mit aus dem Gespräch extrahierten
          Kontaktdaten (Name, E-Mail, Telefonnummer — sofern Sie diese im Demo-Gespräch nennen) für
          bis zu 90 Tage in unserer Datenbank gespeichert. Wir verwenden diese Daten ausschließlich zur
          Qualitätssicherung der Demo, zur Verbesserung des Sprach-Agenten und — sofern Sie im Demo-
          Gespräch ein Interesse an unserem Produkt äußern — als Lead, den unser Team manuell
          bearbeitet. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an Produkt-
          verbesserung und Lead-Aufnahme nach freiwilliger Anfrage). Sie können der Speicherung
          jederzeit widersprechen — schreiben Sie uns dazu eine E-Mail an info@phonbot.de mit der
          Anrufzeit; wir löschen den Datensatz dann manuell.
        </p>

        <h3 className="text-sm font-semibold text-white/90 mt-3 mb-1">Demo-Rückrufe von Phonbot</h3>
        <p>
          Wenn Sie auf phonbot.de das Rückruf-Formular ausfüllen (Name, E-Mail, Telefonnummer), ruft
          unser KI-Assistent Chipy Sie unter der angegebenen Nummer zurück. Der Anruf wird wie oben
          beschrieben aufgezeichnet und für bis zu 90 Tage gespeichert. Sie können der weiteren
          Kontaktaufnahme jederzeit widersprechen (DSGVO Art. 21) — Chipy akzeptiert ein
          „kein Interesse" / „nicht mehr anrufen" sofort und beendet das Gespräch. Rechtsgrundlage:
          Art. 6 Abs. 1 lit. a DSGVO (Einwilligung durch Formular-Eintragung).
        </p>

        <h3 className="text-sm font-semibold text-white/90 mt-3 mb-1">Verbesserung unserer KI-Modelle</h3>
        <p>
          Zur kontinuierlichen Verbesserung unseres Sprach-Agenten speichern wir in bestimmten Fällen
          kurze Ausschnitte aus Gesprächs-Auswertungen, an denen unsere Plattform-Administratoren
          manuelle Korrekturen vorgenommen haben (sogenannte Korrektur-Tupel: Original-Vorschlag +
          überarbeiteter Text + Begründung). Diese werden für bis zu 365 Tage in einer separaten
          internen Tabelle gespeichert und dienen ausschließlich als Trainingssignal für die nächste
          Generation unseres Vorschlags-Generators. Personenbezogene Inhalte werden vor der Speicherung
          durch unseren PII-Filter (Telefonnummern, E-Mail-Adressen, Kontodaten) bereinigt; die Tupel
          enthalten keine vollständigen Anrufprotokolle. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO
          (berechtigtes Interesse an Produkt-Qualitätssicherung). Sie können einer Verarbeitung
          widersprechen — schreiben Sie uns an info@phonbot.de.
        </p>

        <h3 className="text-sm font-semibold text-white/90 mt-3 mb-1">Twilio (Telefonie-Infrastruktur)</h3>
        <p>
          Für die eigentliche Telefonverbindung (Durchleitung, Rufnummern, SIP-Trunk, SMS) verwenden
          wir Twilio Inc. bzw. Twilio Ireland Limited. Dabei werden Verbindungsdaten (Rufnummer des
          Anrufers, gewählte Nummer, Zeitstempel, Gesprächsdauer, Audio-Streams) verarbeitet. Ein
          Auftragsverarbeitungsvertrag nach Art. 28 DSGVO besteht. Datenübermittlung in die USA auf
          Basis der EU-Standardvertragsklauseln (Art. 46 Abs. 2 lit. c DSGVO) sowie des EU-US Data
          Privacy Framework. Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO. Details:
          twilio.com/en-us/legal/privacy.
        </p>

        <h3 className="text-sm font-semibold text-white/90 mt-3 mb-1">OpenAI (KI-Sprachverarbeitung)</h3>
        <p>
          Zur Analyse und Verarbeitung von Gesprächsinhalten (z. B. Intent-Erkennung, automatische
          Antwortgenerierung, Transkript-Auswertung) setzen wir OpenAI, L.L.C., USA ein. Dabei werden
          Gesprächstranskripte an OpenAI übermittelt. OpenAI verwendet über die API gesendete Daten
          gemäß eigener Richtlinie nicht zum Modell-Training. Ein Auftragsverarbeitungsvertrag nach
          Art. 28 DSGVO besteht (OpenAI Data Processing Addendum). Datenübermittlung in die USA auf
          Basis der EU-Standardvertragsklauseln sowie des EU-US Data Privacy Framework.
          Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO. Details: openai.com/policies/privacy-policy.
        </p>

        <h3 className="text-sm font-semibold text-white/90 mt-3 mb-1">Cloudflare (CAPTCHA &amp; DDoS-Schutz)</h3>
        <p>
          Zur Absicherung öffentlicher Formulare gegen Bot-Missbrauch (Demo-Anfragen, Rückruf-Formular,
          Registrierung) setzen wir Cloudflare Turnstile der Cloudflare, Inc., USA ein. Dabei werden
          IP-Adresse, Browser-Merkmale und eine kurzlebige Challenge-Signatur verarbeitet. Turnstile
          verzichtet auf Tracking-Cookies. Datenübermittlung in die USA auf Basis der
          EU-Standardvertragsklauseln sowie des EU-US Data Privacy Framework. Rechtsgrundlage: Art. 6
          Abs. 1 lit. f DSGVO (berechtigtes Interesse an Missbrauchsschutz). Details:
          cloudflare.com/privacypolicy.
        </p>

        <h3 className="text-sm font-semibold text-white/90 mt-3 mb-1">Sentry (Fehlerüberwachung)</h3>
        <p>
          Zur Erkennung und Behebung technischer Fehler setzen wir Sentry (Functional Software, Inc.,
          San Francisco, USA) ein. Sentry erfasst anonymisierte Fehlerberichte (Error-Tracking), die
          technische Informationen wie Browsertyp, Betriebssystem und Fehlermeldungen enthalten.
          Personenbezogene Daten (E-Mail, IP-Adresse, Cookies, Auth-Token) werden vor der Übermittlung
          entfernt (PII-Filter). Der Einsatz erfolgt auf Grundlage unseres berechtigten Interesses an
          einem stabilen und sicheren Betrieb der Plattform. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white mb-2">5. Hosting</h2>
        <p>
          Diese Website wird auf Servern in Deutschland gehostet. Anbieter: Supabase (EU).
          Durch die Nutzung dieser Website werden personenbezogene Daten auf diesen
          Servern gespeichert. Zwischen uns und dem Hosting-Anbieter besteht ein
          Auftragsverarbeitungsvertrag gemäß Art. 28 DSGVO.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white mb-2">6. Kontakt Datenschutz</h2>
        <p>
          Bei Fragen zum Datenschutz wende dich an:<br />
          Hans Ulrich Waier (Einzelunternehmer)<br />
          z. Hd. Hans Ulrich Waier<br />
          Scharnhorststraße 8, 12307 Berlin<br />
          Telefon: +49 30 75937169<br />
          E-Mail: info@phonbot.de
        </p>
        <p className="mt-2 text-white/50 text-xs">
          Stand: April 2026
        </p>
      </section>
    </div>
  );
}

function AgbContent() {
  return (
    <div className="space-y-6 text-white/80 text-sm leading-relaxed">
      <section>
        <h2 className="text-base font-semibold text-white mb-2">§ 1 Geltungsbereich</h2>
        <p>
          Diese Allgemeinen Geschäftsbedingungen (AGB) gelten für alle Verträge zwischen von Hans Ulrich Waier (Einzelunternehmer) (nachfolgend „Anbieter") und dem Kunden (nachfolgend „Nutzer") über die Nutzung
          der Phonbot-Plattform. Abweichende Bedingungen des Nutzers werden nicht anerkannt, es sei
          denn, der Anbieter stimmt ihrer Geltung ausdrücklich schriftlich zu.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white mb-2">§ 2 Vertragsschluss</h2>
        <p>
          Der Vertrag kommt durch die Registrierung auf der Plattform und die Bestätigung durch den
          Anbieter zustande. Mit der Registrierung erklärt der Nutzer, die vorliegenden AGB gelesen und
          akzeptiert zu haben. Die Vertragssprache ist Deutsch.
        </p>
        <p className="mt-2">
          Der Anbieter behält sich das Recht vor, Registrierungen ohne Angabe von Gründen abzulehnen.
          Eine Registrierung ist nur für Personen ab 18 Jahren sowie für Unternehmen mit rechtsfähigem
          Vertreter zulässig.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white mb-2">§ 3 Leistungsbeschreibung</h2>
        <p>
          Der Anbieter stellt eine cloudbasierte SaaS-Plattform bereit, die es Nutzern ermöglicht,
          KI-gestützte Telefonagenten zu konfigurieren und zu betreiben. Die Leistungen umfassen
          insbesondere:
        </p>
        <ul className="list-disc list-inside space-y-1 mt-2">
          <li>Bereitstellung und Betrieb von KI-Telefonagenten</li>
          <li>Verwaltung von Telefonanrufen, Terminbuchungen und Tickets</li>
          <li>Dashboard zur Übersicht und Konfiguration</li>
          <li>Optionale Kalender-Integration</li>
        </ul>
        <p className="mt-2">
          Der Anbieter ist berechtigt, Leistungen durch Dritte zu erbringen. Ein Anspruch auf eine
          bestimmte Verfügbarkeit wird nicht garantiert; der Anbieter strebt eine Verfügbarkeit von 99 %
          im Monatsmittel an.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white mb-2">§ 4 Nutzungsbedingungen</h2>
        <p>
          Der Nutzer verpflichtet sich, die Plattform ausschließlich für legale Zwecke zu verwenden. Es
          ist insbesondere untersagt:
        </p>
        <ul className="list-disc list-inside space-y-1 mt-2">
          <li>Spam- oder Massennachrichten zu versenden</li>
          <li>Dritte zu belästigen, zu täuschen oder zu schädigen</li>
          <li>Gegen geltendes Recht (inkl. UWG, DSGVO, TKG) zu verstoßen</li>
          <li>Die Plattform zu reverse-engineeren oder unbefugt zu vervielfältigen</li>
          <li>Die Systemsicherheit zu gefährden oder zu umgehen</li>
        </ul>
        <p className="mt-2">
          Bei Verstößen ist der Anbieter berechtigt, den Zugang unverzüglich zu sperren und den Vertrag
          außerordentlich zu kündigen.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white mb-2">§ 5 Zahlungsbedingungen</h2>
        <p>
          Die Vergütung richtet sich nach dem zum Zeitpunkt der Buchung geltenden Preismodell auf der
          Website. Alle Preise verstehen sich zzgl. der gesetzlichen Mehrwertsteuer, sofern nicht anders
          angegeben.
        </p>
        <p className="mt-2">
          Die Zahlung erfolgt monatlich im Voraus per Kreditkarte oder SEPA-Lastschrift über den
          Zahlungsdienstleister Stripe. Bei Zahlungsverzug ist der Anbieter berechtigt, den Zugang zur
          Plattform zu sperren. Überschreitungen des gebuchten Minutenvolumens werden gemäß dem
          aktuellen Tarif im Folgemonat abgerechnet.
        </p>
        <p className="mt-2">
          <strong>Sekundengenaue Abrechnung:</strong> Gesprächsminuten werden sekundengenau ermittelt und
          in Dezimalminuten (zwei Nachkommastellen) verrechnet. Ein Anruf von 61 Sekunden zählt als
          1,02 Minuten, nicht als 2 Minuten. Der Kunde zahlt ausschließlich für die tatsächlich
          genutzte Gesprächszeit.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white mb-2">§ 6 Laufzeit und Kündigung</h2>
        <p>
          Verträge werden auf unbestimmte Zeit geschlossen und können jeweils zum Ende des
          Abrechnungszeitraums (Monat) gekündigt werden. Die Kündigung kann jederzeit im Nutzerkonto
          oder per E-Mail an info@phonbot.de erfolgen.
        </p>
        <p className="mt-2">
          Das Recht zur außerordentlichen Kündigung aus wichtigem Grund bleibt beiderseits unberührt.
          Nach Kündigung werden Nutzerdaten gemäß unserer Datenschutzerklärung gelöscht.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white mb-2">§ 7 Haftung</h2>
        <p>
          Der Anbieter haftet unbeschränkt für Schäden aus der Verletzung des Lebens, des Körpers oder
          der Gesundheit sowie für vorsätzliche oder grob fahrlässige Pflichtverletzungen.
        </p>
        <p className="mt-2">
          Bei leichter Fahrlässigkeit haftet der Anbieter nur bei Verletzung wesentlicher
          Vertragspflichten (Kardinalpflichten), und zwar begrenzt auf den vorhersehbaren,
          vertragstypischen Schaden. Im Übrigen ist die Haftung des Anbieters ausgeschlossen.
        </p>
        <p className="mt-2">
          Der Anbieter übernimmt keine Haftung für Schäden, die durch Fehlfunktionen von Dritten (z. B.
          Retell AI, Stripe) oder durch höhere Gewalt entstehen.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white mb-2">§ 8 Änderungen der AGB</h2>
        <p>
          Der Anbieter behält sich vor, diese AGB mit einer Frist von mindestens 30 Tagen vor
          Inkrafttreten zu ändern. Änderungen werden dem Nutzer per E-Mail mitgeteilt. Widerspricht der
          Nutzer nicht innerhalb von 30 Tagen nach Zugang der Mitteilung, gelten die geänderten AGB als
          akzeptiert.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white mb-2">§ 9 Anwendbares Recht und Gerichtsstand</h2>
        <p>
          Es gilt das Recht der Bundesrepublik Deutschland unter Ausschluss des UN-Kaufrechts. Ist der
          Nutzer Kaufmann, juristische Person des öffentlichen Rechts oder öffentlich-rechtliches
          Sondervermögen, ist Gerichtsstand der Sitz des Anbieters.
        </p>
        <p className="mt-2 text-white/50 text-xs">
          Stand: März 2025
        </p>
      </section>
    </div>
  );
}

export function LegalModal({ page, onClose }: Props) {
  function handleBackdrop(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  // Audit-Round-11 MED (Codex P2): a11y — Esc-to-close, focus-trap, focus
  // restore. Mirrors the OwlyDemoModal pattern.
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const previouslyFocused = (typeof document !== 'undefined' ? document.activeElement : null) as HTMLElement | null;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!first || !last) return;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', handleKey);
    queueMicrotask(() => {
      const first = dialogRef.current?.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled])',
      );
      first?.focus();
    });
    return () => {
      document.removeEventListener('keydown', handleKey);
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      onClick={handleBackdrop}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="legal-modal-title"
        className="relative w-full max-w-2xl rounded-3xl overflow-hidden fade-up"
        style={{
          background: 'rgba(15,15,24,0.97)',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 0 80px rgba(249,115,22,0.08), 0 0 0 1px rgba(255,255,255,0.06)',
          backdropFilter: 'blur(24px)',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-5 shrink-0"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}
        >
          <h2 id="legal-modal-title" className="text-lg font-bold text-white">{TITLES[page]}</h2>
          <button
            onClick={onClose}
            aria-label="Schließen"
            className="w-8 h-8 flex items-center justify-center rounded-full text-white/50 hover:text-white hover:bg-white/10 transition-all text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto px-6 py-6 flex-1">
          {page === 'impressum' && <ImpressumContent />}
          {page === 'datenschutz' && <DatenschutzContent />}
          {page === 'agb' && <AgbContent />}
        </div>

        {/* Footer */}
        <div
          className="px-6 py-4 shrink-0 flex justify-end"
          style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}
        >
          <button
            onClick={onClose}
            className="rounded-full px-6 py-2 text-sm font-semibold text-white/70 hover:text-white transition-colors"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}
          >
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}
