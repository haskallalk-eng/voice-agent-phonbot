import React from 'react';

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
          Mindrails<br />
          Hassieb Kalla<br />
          Scharnhorststraße 8<br />
          12307 Berlin<br />
          Deutschland
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white mb-2">Kontakt</h2>
        <p>
          Telefon: +49 176 76679632<br />
          E-Mail: info@mindrails.de<br />
          Web: phonbot.de
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white mb-2">
          Verantwortlich für den Inhalt nach § 55 Abs. 2 RStV
        </h2>
        <p>
          Hassieb Kalla<br />
          Scharnhorststraße 8<br />
          12307 Berlin, Deutschland
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
          Mindrails — Hassieb Kalla<br />
          Scharnhorststraße 8, 12307 Berlin<br />
          E-Mail: info@mindrails.de
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
          Zur Ausübung Ihrer Rechte wenden Sie sich bitte an: info@mindrails.de
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
          Für die KI-gestützte Sprachverarbeitung von Telefonanrufen verwenden wir Retell AI. Bei
          Telefonanrufen werden Sprachdaten zur Verarbeitung übertragen. Nutzer werden zu Beginn eines
          Anrufs auf die Aufzeichnung hingewiesen. Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO bzw.
          Art. 6 Abs. 1 lit. a DSGVO.
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
        <h2 className="text-base font-semibold text-white mb-2">6. Datenschutzbeauftragter</h2>
        <p>
          Kontakt Datenschutz:<br />
          Hassieb Kalla<br />
          Scharnhorststraße 8, 12307 Berlin<br />
          Telefon: +49 176 76679632<br />
          E-Mail: info@mindrails.de
        </p>
        <p className="mt-2 text-white/50 text-xs">
          Stand: März 2025
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
          Diese Allgemeinen Geschäftsbedingungen (AGB) gelten für alle Verträge zwischen Mindrails (nachfolgend „Anbieter") und dem Kunden (nachfolgend „Nutzer") über die Nutzung
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
      </section>

      <section>
        <h2 className="text-base font-semibold text-white mb-2">§ 6 Laufzeit und Kündigung</h2>
        <p>
          Verträge werden auf unbestimmte Zeit geschlossen und können jeweils zum Ende des
          Abrechnungszeitraums (Monat) gekündigt werden. Die Kündigung kann jederzeit im Nutzerkonto
          oder per E-Mail an info@mindrails.de erfolgen.
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

  return (
    <div
      onClick={handleBackdrop}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }}
    >
      <div
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
          <h2 className="text-lg font-bold text-white">{TITLES[page]}</h2>
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
