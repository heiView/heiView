import React from 'react'
import { Layout, ConfigProvider, Typography, Space, theme as antdTheme } from 'antd'
import useStore from './store'
import DarkModeButton from './components/DarkModeButton/DarkModeButton'
import './styles.css'

const PrivacyPolicy: React.FC = () => {
  const theme = useStore((state) => state.theme)

  const appTheme = React.useMemo(
    () => ({
      algorithm: theme === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
      token: {
        colorPrimary: theme === 'dark' ? '#7ab2ff' : '#0f62fe',
        borderRadius: 16,
        fontFamily: 'Manrope, "Noto Sans SC", "PingFang SC", sans-serif',
      },
    }),
    [theme]
  )

  React.useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark')
    } else {
      document.documentElement.removeAttribute('data-theme')
    }
  }, [theme])

  return (
    <ConfigProvider theme={appTheme}>
      <Layout className="hei-layout">
        <div className="hei-orb hei-orb-a" />
        <div className="hei-orb hei-orb-b" />

        <Layout.Content className="hei-content">
          <header className="hei-topbar">
            <div className="hei-topbar-inner" style={{ justifyContent: 'space-between' }}>
              <div className="hei-brand-cluster">
                <div className="hei-brand-row">
                  <a href="/" style={{ display: 'flex', alignItems: 'center' }}>
                    <img src="/heiView_logo.png" alt="heiView" className="hei-brand-logo" />
                  </a>
                </div>
              </div>
              
              <div className="hei-toolbar-actions">
                <Space size="middle" wrap align="center">
                  <DarkModeButton className="hei-toolbar-icon-button" />
                </Space>
              </div>
            </div>
          </header>

          <div className="hei-shell" style={{ maxWidth: '800px', margin: '0 auto', padding: '24px' }}>
            <section className="hei-board-card" style={{ padding: '40px' }}>
              <Typography>
                <Typography.Title level={1}>Datenschutzerklärung</Typography.Title>
                <Typography.Paragraph type="secondary">
                  Stand: {new Date().toLocaleDateString('de-DE')}
                </Typography.Paragraph>

                <Typography.Title level={2}>1. Datenschutz auf einen Blick</Typography.Title>
                <Typography.Title level={3}>Allgemeine Hinweise</Typography.Title>
                <Typography.Paragraph>
                  Die folgenden Hinweise geben einen einfachen Überblick darüber, was mit Ihren personenbezogenen Daten
                  passiert, wenn Sie diese Website besuchen. Personenbezogene Daten sind alle Daten, mit denen Sie
                  persönlich identifiziert werden können. Ausführliche Informationen zum Thema Datenschutz entnehmen
                  Sie unserer unter diesem Text aufgeführten Datenschutzerklärung.
                </Typography.Paragraph>

                <Typography.Title level={3}>Datenerfassung auf dieser Website</Typography.Title>
                <Typography.Paragraph>
                  <strong>Wer ist verantwortlich für die Datenerfassung auf dieser Website?</strong><br />
                  Die Datenverarbeitung auf dieser Website erfolgt durch den Websitebetreiber. Dessen Kontaktdaten
                  können Sie dem Abschnitt „Hinweis zur Verantwortlichen Stelle“ in dieser Datenschutzerklärung entnehmen.
                </Typography.Paragraph>
                <Typography.Paragraph>
                  <strong>Wie erfassen wir Ihre Daten?</strong><br />
                  Ihre Daten werden zum einen dadurch erhoben, dass Sie uns diese mitteilen. Hierbei kann es sich z. B. um
                  Daten handeln, die Sie in ein Kontaktformular eingeben.<br />
                  Andere Daten werden automatisch oder nach Ihrer Einwilligung beim Besuch der Website durch unsere IT-
                  Systeme erfasst. Das sind vor allem technische Daten (z. B. Internetbrowser, Betriebssystem oder Uhrzeit
                  des Seitenaufrufs). Die Erfassung dieser Daten erfolgt automatisch, sobald Sie diese Website betreten.
                </Typography.Paragraph>
                <Typography.Paragraph>
                  <strong>Wofür nutzen wir Ihre Daten?</strong><br />
                  Ein Teil der Daten wird erhoben, um eine fehlerfreie Bereitstellung der Website zu gewährleisten. Andere
                  Daten können zur Analyse Ihres Nutzerverhaltens verwendet werden. Sofern über die Website Verträge
                  geschlossen oder angebahnt werden können, werden die übermittelten Daten auch für Vertragsangebote,
                  Bestellungen oder sonstige Auftragsanfragen verarbeitet.
                </Typography.Paragraph>
                <Typography.Paragraph>
                  <strong>Welche Rechte haben Sie bezüglich Ihrer Daten?</strong><br />
                  Sie haben jederzeit das Recht, unentgeltlich Auskunft über Herkunft, Empfänger und Zweck Ihrer
                  gespeicherten personenbezogenen Daten zu erhalten. Sie haben außerdem ein Recht, die Berichtigung oder
                  Löschung dieser Daten zu verlangen. Wenn Sie eine Einwilligung zur Datenverarbeitung erteilt haben,
                  können Sie diese Einwilligung jederzeit für die Zukunft widerrufen. Außerdem haben Sie das Recht, unter
                  bestimmten Umständen die Einschränkung der Verarbeitung Ihrer personenbezogenen Daten zu verlangen.
                  Des Weiteren steht Ihnen ein Beschwerderecht bei der zuständigen Aufsichtsbehörde zu.<br />
                  Hierzu sowie zu weiteren Fragen zum Thema Datenschutz können Sie sich jederzeit an uns wenden.
                </Typography.Paragraph>

                <Typography.Title level={3}>Analyse-Tools und Tools von Drittanbietern</Typography.Title>
                <Typography.Paragraph>
                  Beim Besuch dieser Website kann Ihr Surf-Verhalten statistisch ausgewertet werden. Das geschieht vor
                  allem mit sogenannten Analyseprogrammen.<br />
                  Detaillierte Informationen zu diesen Analyseprogrammen finden Sie in der folgenden
                  Datenschutzerklärung.
                </Typography.Paragraph>

                <Typography.Title level={2}>2. Hosting</Typography.Title>
                <Typography.Paragraph>
                  Wir hosten die Inhalte unserer Website bei folgendem Anbieter:
                </Typography.Paragraph>
                <Typography.Title level={3}>Externes Hosting</Typography.Title>
                <Typography.Paragraph>
                  Diese Website wird extern gehostet. Die personenbezogenen Daten, die auf dieser Website erfasst werden,
                  werden auf den Servern des Hosters / der Hoster gespeichert. Hierbei kann es sich v. a. um IP-Adressen,
                  Kontaktanfragen, Meta- und Kommunikationsdaten, Vertragsdaten, Kontaktdaten, Namen, Websitezugriffe
                  und sonstige Daten, die über eine Website generiert werden, handeln.<br />
                  Das externe Hosting erfolgt zum Zwecke der Vertragserfüllung gegenüber unseren potenziellen und
                  bestehenden Kunden (Art. 6 Abs. 1 lit. b DSGVO) und im Interesse einer sicheren, schnellen und effizienten
                  Bereitstellung unseres Online-Angebots durch einen professionellen Anbieter (Art. 6 Abs. 1 lit. f DSGVO).
                  Sofern eine entsprechende Einwilligung abgefragt wurde, erfolgt die Verarbeitung ausschließlich auf
                  Grundlage von Art. 6 Abs. 1 lit. a DSGVO und § 25 Abs. 1 TDDDG, soweit die Einwilligung die Speicherung
                  von Cookies oder den Zugriff auf Informationen im Endgerät des Nutzers (z. B. Device-Fingerprinting) im
                  Sinne des TDDDG umfasst. Die Einwilligung ist jederzeit widerrufbar.<br />
                  Unser(e) Hoster wird bzw. werden Ihre Daten nur insoweit verarbeiten, wie dies zur Erfüllung seiner
                  Leistungspflichten erforderlich ist und unsere Weisungen in Bezug auf diese Daten befolgen.
                </Typography.Paragraph>
                <Typography.Paragraph>
                  <strong>Wir setzen folgende(n) Hoster ein:</strong><br />
                  Oracle Garden Tower, Neue Mainzer Str. 46-50/46-50, 60311 Frankfurt am Main
                </Typography.Paragraph>
                <Typography.Title level={3}>Auftragsverarbeitung</Typography.Title>
                <Typography.Paragraph>
                  Wir haben einen Vertrag über Auftragsverarbeitung (AVV) zur Nutzung des oben genannten Dienstes
                  geschlossen. Hierbei handelt es sich um einen datenschutzrechtlich vorgeschriebenen Vertrag, der
                  gewährleistet, dass dieser die personenbezogenen Daten unserer Websitebesucher nur nach unseren
                  Weisungen und unter Einhaltung der DSGVO verarbeitet.
                </Typography.Paragraph>

                <Typography.Title level={2}>3. Allgemeine Hinweise und Pflichtinformationen</Typography.Title>
                <Typography.Title level={3}>Datenschutz</Typography.Title>
                <Typography.Paragraph>
                  Die Betreiber dieser Seiten nehmen den Schutz Ihrer persönlichen Daten sehr ernst. Wir behandeln Ihre
                  personenbezogenen Daten vertraulich und entsprechend den gesetzlichen Datenschutzvorschriften sowie
                  dieser Datenschutzerklärung.<br />
                  Wenn Sie diese Website benutzen, werden verschiedene personenbezogene Daten erhoben.
                  Personenbezogene Daten sind Daten, mit denen Sie persönlich identifiziert werden können. Die vorliegende
                  Datenschutzerklärung erläutert, welche Daten wir erheben und wofür wir sie nutzen. Sie erläutert auch, wie
                  und zu welchem Zweck das geschieht.<br />
                  Wir weisen darauf hin, dass die Datenübertragung im Internet (z. B. bei der Kommunikation per E-Mail)
                  Sicherheitslücken aufweisen kann. Ein lückenloser Schutz der Daten vor dem Zugriff durch Dritte ist nicht
                  möglich.
                </Typography.Paragraph>

                <Typography.Title level={3}>Hinweis zur verantwortlichen Stelle</Typography.Title>
                <Typography.Paragraph>
                  Die verantwortliche Stelle für die Datenverarbeitung auf dieser Website ist:<br />
                  Mengbi Yu<br />
                  Robacher Str.110-245 245<br />
                  Telefon: 015228030743<br />
                  E-Mail: mengxibitan.yu@gmail.com
                </Typography.Paragraph>
                <Typography.Paragraph>
                  Verantwortliche Stelle ist die natürliche oder juristische Person, die allein oder gemeinsam mit anderen über
                  die Zwecke und Mittel der Verarbeitung von personenbezogenen Daten (z. B. Namen, E-Mail-Adressen o. Ä.)
                  entscheidet.
                </Typography.Paragraph>

                <Typography.Title level={3}>Speicherdauer</Typography.Title>
                <Typography.Paragraph>
                  Soweit innerhalb dieser Datenschutzerklärung keine speziellere Speicherdauer genannt wurde, verbleiben
                  Ihre personenbezogenen Daten bei uns, bis der Zweck für die Datenverarbeitung entfällt. Wenn Sie ein
                  berechtigtes Löschersuchen geltend machen oder eine Einwilligung zur Datenverarbeitung widerrufen,
                  werden Ihre Daten gelöscht, sofern wir keine anderen rechtlich zulässigen Gründe für die Speicherung Ihrer
                  personenbezogenen Daten haben (z. B. steuer- oder handelsrechtliche Aufbewahrungsfristen); im
                  letztgenannten Fall erfolgt die Löschung nach Fortfall dieser Gründe.
                </Typography.Paragraph>

                <Typography.Title level={3}>Allgemeine Hinweise zu den Rechtsgrundlagen der Datenverarbeitung auf dieser Website</Typography.Title>
                <Typography.Paragraph>
                  Sofern Sie in die Datenverarbeitung eingewilligt haben, verarbeiten wir Ihre personenbezogenen Daten auf
                  Grundlage von Art. 6 Abs. 1 lit. a DSGVO bzw. Art. 9 Abs. 2 lit. a DSGVO, sofern besondere Datenkategorien
                  nach Art. 9 Abs. 1 DSGVO verarbeitet werden. Im Falle einer ausdrücklichen Einwilligung in die Übertragung
                  personenbezogener Daten in Drittstaaten erfolgt die Datenverarbeitung außerdem auf Grundlage von Art.
                  49 Abs. 1 lit. a DSGVO. Sofern Sie in die Speicherung von Cookies oder in den Zugriff auf Informationen in
                  Ihr Endgerät (z. B. via Device-Fingerprinting) eingewilligt haben, erfolgt die Datenverarbeitung zusätzlich
                  auf Grundlage von § 25 Abs. 1 TDDDG. Die Einwilligung ist jederzeit widerrufbar. Sind Ihre Daten zur
                  Vertragserfüllung oder zur Durchführung vorvertraglicher Maßnahmen erforderlich, verarbeiten wir Ihre
                  Daten auf Grundlage des Art. 6 Abs. 1 lit. b DSGVO. Des Weiteren verarbeiten wir Ihre Daten, sofern diese
                  zur Erfüllung einer rechtlichen Verpflichtung erforderlich sind auf Grundlage von Art. 6 Abs. 1 lit. c DSGVO.
                  Die Datenverarbeitung kann ferner auf Grundlage unseres berechtigten Interesses nach Art. 6 Abs. 1 lit. f
                  DSGVO erfolgen. Über die jeweils im Einzelfall einschlägigen Rechtsgrundlagen wird in den folgenden
                  Absätzen dieser Datenschutzerklärung informiert.
                </Typography.Paragraph>

                <Typography.Title level={3}>Empfänger von personenbezogenen Daten</Typography.Title>
                <Typography.Paragraph>
                  Im Rahmen unserer Geschäftstätigkeit arbeiten wir mit verschiedenen externen Stellen zusammen. Dabei
                  ist teilweise auch eine Übermittlung von personenbezogenen Daten an diese externen Stellen erforderlich.
                  Wir geben personenbezogene Daten nur dann an externe Stellen weiter, wenn dies im Rahmen einer
                  Vertragserfüllung erforderlich ist, wenn wir gesetzlich hierzu verpflichtet sind (z. B. Weitergabe von Daten
                  an Steuerbehörden), wenn wir ein berechtigtes Interesse nach Art. 6 Abs. 1 lit. f DSGVO an der Weitergabe
                  haben oder wenn eine sonstige Rechtsgrundlage die Datenweitergabe erlaubt. Beim Einsatz von
                  Auftragsverarbeitern geben wir personenbezogene Daten unserer Kunden nur auf Grundlage eines gültigen
                  Vertrags über Auftragsverarbeitung weiter. Im Falle einer gemeinsamen Verarbeitung wird ein Vertrag über
                  gemeinsame Verarbeitung geschlossen.
                </Typography.Paragraph>

                <Typography.Title level={3}>Widerruf Ihrer Einwilligung zur Datenverarbeitung</Typography.Title>
                <Typography.Paragraph>
                  Viele Datenverarbeitungsvorgänge sind nur mit Ihrer ausdrücklichen Einwilligung möglich. Sie können eine
                  bereits erteilte Einwilligung jederzeit widerrufen. Die Rechtmäßigkeit der bis zum Widerruf erfolgten
                  Datenverarbeitung bleibt vom Widerruf unberührt.
                </Typography.Paragraph>

                <Typography.Title level={3}>Widerspruchsrecht gegen die Datenerhebung in besonderen Fällen sowie gegen Direktwerbung (Art. 21 DSGVO)</Typography.Title>
                <Typography.Paragraph>
                  WENN DIE DATENVERARBEITUNG AUF GRUNDLAGE VON ART. 6 ABS. 1 LIT. E ODER F DSGVO
                  ERFOLGT, HABEN SIE JEDERZEIT DAS RECHT, AUS GRÜNDEN, DIE SICH AUS IHRER BESONDEREN
                  SITUATION ERGEBEN, GEGEN DIE VERARBEITUNG IHRER PERSONENBEZOGENEN DATEN
                  WIDERSPRUCH EINZULEGEN; DIES GILT AUCH FÜR EIN AUF DIESE BESTIMMUNGEN GESTÜTZTES
                  PROFILING. DIE JEWEILIGE RECHTSGRUNDLAGE, AUF DENEN EINE VERARBEITUNG BERUHT,
                  ENTNEHMEN SIE DIESER DATENSCHUTZERKLÄRUNG. WENN SIE WIDERSPRUCH EINLEGEN,
                  WERDEN WIR IHRE BETROFFENEN PERSONENBEZOGENEN DATEN NICHT MEHR VERARBEITEN, ES
                  SEI DENN, WIR KÖNNEN ZWINGENDE SCHUTZWÜRDIGE GRÜNDE FÜR DIE VERARBEITUNG
                  NACHWEISEN, DIE IHRE INTERESSEN, RECHTE UND FREIHEITEN ÜBERWIEGEN ODER DIE
                  VERARBEITUNG DIENT DER GELTENDMACHUNG, AUSÜBUNG ODER VERTEIDIGUNG VON
                  RECHTSANSPRÜCHEN (WIDERSPRUCH NACH ART. 21 ABS. 1 DSGVO).
                </Typography.Paragraph>
                <Typography.Paragraph>
                  WERDEN IHRE PERSONENBEZOGENEN DATEN VERARBEITET, UM DIREKTWERBUNG ZU BETREIBEN,
                  SO HABEN SIE DAS RECHT, JEDERZEIT WIDERSPRUCH GEGEN DIE VERARBEITUNG SIE
                  BETREFFENDER PERSONENBEZOGENER DATEN ZUM ZWECKE DERARTIGER WERBUNG
                  EINZULEGEN; DIES GILT AUCH FÜR DAS PROFILING, SOWEIT ES MIT SOLCHER DIREKTWERBUNG IN
                  VERBINDUNG STEHT. WENN SIE WIDERSPRECHEN, WERDEN IHRE PERSONENBEZOGENEN DATEN
                  ANSCHLIESSEND NICHT MEHR ZUM ZWECKE DER DIREKTWERBUNG VERWENDET (WIDERSPRUCH
                  NACH ART. 21 ABS. 2 DSGVO).
                </Typography.Paragraph>

                <Typography.Title level={3}>Beschwerderecht bei der zuständigen Aufsichtsbehörde</Typography.Title>
                <Typography.Paragraph>
                  Im Falle von Verstößen gegen die DSGVO steht den Betroffenen ein Beschwerderecht bei einer
                  Aufsichtsbehörde, insbesondere in dem Mitgliedstaat ihres gewöhnlichen Aufenthalts, ihres Arbeitsplatzes
                  oder des Orts des mutmaßlichen Verstoßes zu. Das Beschwerderecht besteht unbeschadet anderweitiger
                  verwaltungsrechtlicher oder gerichtlicher Rechtsbehelfe.
                </Typography.Paragraph>

                <Typography.Title level={3}>Recht auf Datenübertragbarkeit</Typography.Title>
                <Typography.Paragraph>
                  Sie haben das Recht, Daten, die wir auf Grundlage Ihrer Einwilligung oder in Erfüllung eines Vertrags
                  automatisiert verarbeiten, an sich oder an einen Dritten in einem gängigen, maschinenlesbaren Format
                  aushändigen zu lassen. Sofern Sie die direkte Übertragung der Daten an einen anderen Verantwortlichen
                  verlangen, erfolgt dies nur, soweit es technisch machbar ist.
                </Typography.Paragraph>

                <Typography.Title level={3}>Auskunft, Berichtigung und Löschung</Typography.Title>
                <Typography.Paragraph>
                  Sie haben im Rahmen der geltenden gesetzlichen Bestimmungen jederzeit das Recht auf unentgeltliche
                  Auskunft über Ihre gespeicherten personenbezogenen Daten, deren Herkunft und Empfänger und den
                  Zweck der Datenverarbeitung und ggf. ein Recht auf Berichtigung oder Löschung dieser Daten. Hierzu sowie
                  zu weiteren Fragen zum Thema personenbezogene Daten können Sie sich jederzeit an uns wenden.
                </Typography.Paragraph>

                <Typography.Title level={3}>Recht auf Einschränkung der Verarbeitung</Typography.Title>
                <Typography.Paragraph>
                  Sie haben das Recht, die Einschränkung der Verarbeitung Ihrer personenbezogenen Daten zu verlangen.
                  Hierzu können Sie sich jederzeit an uns wenden. Das Recht auf Einschränkung der Verarbeitung besteht in
                  folgenden Fällen:<br />
                  - Wenn Sie die Richtigkeit Ihrer bei uns gespeicherten personenbezogenen Daten bestreiten, benötigen wir
                  in der Regel Zeit, um dies zu überprüfen. Für die Dauer der Prüfung haben Sie das Recht, die
                  Einschränkung der Verarbeitung Ihrer personenbezogenen Daten zu verlangen.<br />
                  - Wenn die Verarbeitung Ihrer personenbezogenen Daten unrechtmäßig geschah/geschieht, können Sie
                  statt der Löschung die Einschränkung der Datenverarbeitung verlangen.<br />
                  - Wenn wir Ihre personenbezogenen Daten nicht mehr benötigen, Sie sie jedoch zur Ausübung,
                  Verteidigung oder Geltendmachung von Rechtsansprüchen benötigen, haben Sie das Recht, statt der
                  Löschung die Einschränkung der Verarbeitung Ihrer personenbezogenen Daten zu verlangen.<br />
                  - Wenn Sie einen Widerspruch nach Art. 21 Abs. 1 DSGVO eingelegt haben, muss eine Abwägung zwischen
                  Ihren und unseren Interessen vorgenommen werden. Solange noch nicht feststeht, wessen Interessen
                  überwiegen, haben Sie das Recht, die Einschränkung der Verarbeitung Ihrer personenbezogenen Daten
                  zu verlangen.<br />
                  Wenn Sie die Verarbeitung Ihrer personenbezogenen Daten eingeschränkt haben, dürfen diese Daten – von
                  ihrer Speicherung abgesehen – nur mit Ihrer Einwilligung oder zur Geltendmachung, Ausübung oder
                  Verteidigung von Rechtsansprüchen oder zum Schutz der Rechte einer anderen natürlichen oder
                  juristischen Person oder aus Gründen eines wichtigen öffentlichen Interesses der Europäischen Union oder
                  eines Mitgliedstaats verarbeitet werden.
                </Typography.Paragraph>

                <Typography.Title level={3}>SSL- bzw. TLS-Verschlüsselung</Typography.Title>
                <Typography.Paragraph>
                  Diese Seite nutzt aus Sicherheitsgründen und zum Schutz der Übertragung vertraulicher Inhalte, wie zum
                  Beispiel Bestellungen oder Anfragen, die Sie an uns als Seitenbetreiber senden, eine SSL- bzw. TLS-
                  Verschlüsselung. Eine verschlüsselte Verbindung erkennen Sie daran, dass die Adresszeile des Browsers von
                  „http://“ auf „https://“ wechselt und an dem Schloss-Symbol in Ihrer Browserzeile.<br />
                  Wenn die SSL- bzw. TLS-Verschlüsselung aktiviert ist, können die Daten, die Sie an uns übermitteln, nicht
                  von Dritten mitgelesen werden.
                </Typography.Paragraph>

                <Typography.Title level={2}>4. Datenerfassung auf dieser Website</Typography.Title>
                <Typography.Title level={3}>Cookies</Typography.Title>
                <Typography.Paragraph>
                  Unsere Internetseiten verwenden so genannte „Cookies“. Cookies sind kleine Datenpakete und richten auf
                  Ihrem Endgerät keinen Schaden an. Sie werden entweder vorübergehend für die Dauer einer Sitzung
                  (Session-Cookies) oder dauerhaft (permanente Cookies) auf Ihrem Endgerät gespeichert. Session-Cookies
                  werden nach Ende Ihres Besuchs automatisch gelöscht. Permanente Cookies bleiben auf Ihrem Endgerät
                  gespeichert, bis Sie diese selbst löschen oder eine automatische Löschung durch Ihren Webbrowser erfolgt.<br />
                  Cookies können von uns (First-Party-Cookies) oder von Drittunternehmen stammen (sog. Third-Party-
                  Cookies). Third-Party-Cookies ermöglichen die Einbindung bestimmter Dienstleistungen von
                  Drittunternehmen innerhalb von Webseiten (z. B. Cookies zur Abwicklung von Zahlungsdienstleistungen).<br />
                  Cookies haben verschiedene Funktionen. Zahlreiche Cookies sind technisch notwendig, da bestimmte
                  Webseitenfunktionen ohne diese nicht funktionieren würden (z. B. die Warenkorbfunktion oder die Anzeige
                  von Videos). Andere Cookies können zur Auswertung des Nutzerverhaltens oder zu Werbezwecken
                  verwendet werden.<br />
                  Cookies, die zur Durchführung des elektronischen Kommunikationsvorgangs, zur Bereitstellung
                  bestimmter, von Ihnen erwünschter Funktionen (z. B. für die Warenkorbfunktion) oder zur Optimierung der
                  Website (z. B. Cookies zur Messung des Webpublikums) erforderlich sind (notwendige Cookies), werden auf
                  Grundlage von Art. 6 Abs. 1 lit. f DSGVO gespeichert, sofern keine andere Rechtsgrundlage angegeben wird.
                  Der Websitebetreiber hat ein berechtigtes Interesse an der Speicherung von notwendigen Cookies zur
                  technisch fehlerfreien und optimierten Bereitstellung seiner Dienste. Sofern eine Einwilligung zur
                  Speicherung von Cookies und vergleichbaren Wiedererkennungstechnologien abgefragt wurde, erfolgt die
                  Verarbeitung ausschließlich auf Grundlage dieser Einwilligung (Art. 6 Abs. 1 lit. a DSGVO und § 25 Abs. 1
                  TDDDG); die Einwilligung ist jederzeit widerrufbar.<br />
                  Sie können Ihren Browser so einstellen, dass Sie über das Setzen von Cookies informiert werden und
                  Cookies nur im Einzelfall erlauben, die Annahme von Cookies für bestimmte Fälle oder generell ausschließen
                  sowie das automatische Löschen der Cookies beim Schließen des Browsers aktivieren. Bei der
                  Deaktivierung von Cookies kann die Funktionalität dieser Website eingeschränkt sein.<br />
                  Sofern weitere Cookies und Dienste auf dieser Website eingesetzt werden, können Sie dies dieser
                  Datenschutzerklärung entnehmen.
                </Typography.Paragraph>

                <Typography.Title level={3}>Server-Log-Dateien</Typography.Title>
                <Typography.Paragraph>
                  Der Provider der Seiten erhebt und speichert automatisch Informationen in so genannten Server-Log-
                  Dateien, die Ihr Browser automatisch an uns übermittelt. Dies sind:<br />
                  - Browsertyp und Browserversion<br />
                  - verwendetes Betriebssystem<br />
                  - Referrer URL<br />
                  - Hostname des zugreifenden Rechners<br />
                  - Uhrzeit der Serveranfrage<br />
                  - IP-Adresse<br />
                  Eine Zusammenführung dieser Daten mit anderen Datenquellen wird nicht vorgenommen.<br />
                  Die Erfassung dieser Daten erfolgt auf Grundlage von Art. 6 Abs. 1 lit. f DSGVO. Der Websitebetreiber hat
                  ein berechtigtes Interesse an der technisch fehlerfreien Darstellung und der Optimierung seiner Website –
                  hierzu müssen die Server-Log-Files erfasst werden.
                </Typography.Paragraph>

                <Typography.Title level={3}>Kontaktformular</Typography.Title>
                <Typography.Paragraph>
                  Wenn Sie uns per Kontaktformular Anfragen zukommen lassen, werden Ihre Angaben aus dem
                  Anfrageformular inklusive der von Ihnen dort angegebenen Kontaktdaten zwecks Bearbeitung der Anfrage
                  und für den Fall von Anschlussfragen bei uns gespeichert. Diese Daten geben wir nicht ohne Ihre
                  Einwilligung weiter.<br />
                  Die Verarbeitung dieser Daten erfolgt auf Grundlage von Art. 6 Abs. 1 lit. b DSGVO, sofern Ihre Anfrage mit
                  der Erfüllung eines Vertrags zusammenhängt oder zur Durchführung vorvertraglicher Maßnahmen
                  erforderlich ist. In allen übrigen Fällen beruht die Verarbeitung auf unserem berechtigten Interesse an der
                  effektiven Bearbeitung der an uns gerichteten Anfragen (Art. 6 Abs. 1 lit. f DSGVO) oder auf Ihrer
                  Einwilligung (Art. 6 Abs. 1 lit. a DSGVO) sofern diese abgefragt wurde; die Einwilligung ist jederzeit
                  widerrufbar.<br />
                  Die von Ihnen im Kontaktformular eingegebenen Daten verbleiben bei uns, bis Sie uns zur Löschung
                  auffordern, Ihre Einwilligung zur Speicherung widerrufen oder der Zweck für die Datenspeicherung entfällt
                  (z. B. nach abgeschlossener Bearbeitung Ihrer Anfrage). Zwingende gesetzliche Bestimmungen –
                  insbesondere Aufbewahrungsfristen – bleiben unberührt.
                </Typography.Paragraph>

                <Typography.Title level={3}>Anfrage per E-Mail, Telefon oder Telefax</Typography.Title>
                <Typography.Paragraph>
                  Wenn Sie uns per E-Mail, Telefon oder Telefax kontaktieren, wird Ihre Anfrage inklusive aller daraus
                  hervorgehenden personenbezogenen Daten (Name, Anfrage) zum Zwecke der Bearbeitung Ihres Anliegens
                  bei uns gespeichert und verarbeitet. Diese Daten geben wir nicht ohne Ihre Einwilligung weiter.<br />
                  Die Verarbeitung dieser Daten erfolgt auf Grundlage von Art. 6 Abs. 1 lit. b DSGVO, sofern Ihre Anfrage mit
                  der Erfüllung eines Vertrags zusammenhängt oder zur Durchführung vorvertraglicher Maßnahmen
                  erforderlich ist. In allen übrigen Fällen beruht die Verarbeitung auf unserem berechtigten Interesse an der
                  effektiven Bearbeitung der an uns gerichteten Anfragen (Art. 6 Abs. 1 lit. f DSGVO) oder auf Ihrer
                  Einwilligung (Art. 6 Abs. 1 lit. a DSGVO) sofern diese abgefragt wurde; die Einwilligung ist jederzeit
                  widerrufbar.<br />
                  Die von Ihnen an uns per Kontaktanfragen übersandten Daten verbleiben bei uns, bis Sie uns zur Löschung
                  auffordern, Ihre Einwilligung zur Speicherung widerrufen oder der Zweck für die Datenspeicherung entfällt
                  (z. B. nach abgeschlossener Bearbeitung Ihres Anliegens). Zwingende gesetzliche Bestimmungen –
                  insbesondere gesetzliche Aufbewahrungsfristen – bleiben unberührt.
                </Typography.Paragraph>

                <Typography.Title level={3}>Kommentarfunktion auf dieser Website</Typography.Title>
                <Typography.Paragraph>
                  Für die Kommentarfunktion auf dieser Seite werden neben Ihrem Kommentar auch Angaben zum Zeitpunkt
                  der Erstellung des Kommentars, Ihre E-Mail-Adresse und, wenn Sie nicht anonym posten, der von Ihnen
                  gewählte Nutzername gespeichert.
                </Typography.Paragraph>
                <Typography.Paragraph>
                  <strong>Abonnieren von Kommentaren</strong><br />
                  Als Nutzer der Seite können Sie nach einer Anmeldung Kommentare abonnieren. Sie erhalten eine
                  Bestätigungsemail, um zu prüfen, ob Sie der Inhaber der angegebenen E-Mail-Adresse sind. Sie können diese
                  Funktion jederzeit über einen Link in den Info-Mails abbestellen. Die im Rahmen des Abonnierens von
                  Kommentaren eingegebenen Daten werden in diesem Fall gelöscht; wenn Sie diese Daten für andere
                  Zwecke und an anderer Stelle (z. B. Newsletterbestellung) an uns übermittelt haben, verbleiben diese Daten
                  jedoch bei uns.
                </Typography.Paragraph>
                <Typography.Paragraph>
                  <strong>Speicherdauer der Kommentare</strong><br />
                  Die Kommentare und die damit verbundenen Daten werden gespeichert und verbleiben auf dieser Website,
                  bis der kommentierte Inhalt vollständig gelöscht wurde oder die Kommentare aus rechtlichen Gründen
                  gelöscht werden müssen (z. B. beleidigende Kommentare).
                </Typography.Paragraph>
                <Typography.Paragraph>
                  <strong>Rechtsgrundlage</strong><br />
                  Die Speicherung der Kommentare erfolgt auf Grundlage Ihrer Einwilligung (Art. 6 Abs. 1 lit. a DSGVO). Sie
                  können eine von Ihnen erteilte Einwilligung jederzeit widerrufen. Dazu reicht eine formlose Mitteilung per E-
                  Mail an uns. Die Rechtmäßigkeit der bereits erfolgten Datenverarbeitungsvorgänge bleibt vom Widerruf
                  unberührt.
                </Typography.Paragraph>

                <Typography.Title level={2}>5. Plugins und Tools</Typography.Title>
                <Typography.Title level={3}>Google Fonts (lokales Hosting)</Typography.Title>
                <Typography.Paragraph>
                  Diese Seite nutzt zur einheitlichen Darstellung von Schriftarten so genannte Google Fonts, die von Google
                  bereitgestellt werden. Die Google Fonts sind lokal installiert. Eine Verbindung zu Servern von Google findet
                  dabei nicht statt.<br />
                  Weitere Informationen zu Google Fonts finden Sie unter <a href="https://developers.google.com/fonts/faq" target="_blank" rel="noreferrer">https://developers.google.com/fonts/faq</a> und in der Datenschutzerklärung von Google: <a href="https://policies.google.com/privacy?hl=de" target="_blank" rel="noreferrer">https://policies.google.com/privacy?hl=de</a>.
                </Typography.Paragraph>

                <Typography.Title level={3}>Cloudflare Turnstile</Typography.Title>
                <Typography.Paragraph>
                  Wir nutzen Cloudflare Turnstile (im Folgenden „Turnstile“) auf dieser Website. Anbieter ist die Cloudflare
                  Inc., 101 Townsend St., San Francisco, CA 94107, USA (im Folgenden „Cloudflare”).<br />
                  Mit Turnstile soll überprüft werden, ob die Dateneingabe auf dieser Website (z. B. in einem
                  Kontaktformular) durch einen Menschen oder durch ein automatisiertes Programm erfolgt. Hierzu
                  analysiert Turnstile das Verhalten des Websitebesuchers anhand verschiedener Merkmale.<br />
                  Diese Analyse beginnt automatisch, sobald der Websitebesucher eine Website mit aktiviertem Turnstile
                  betritt. Zur Analyse wertet Turnstile verschiedene Informationen aus (z. B. IP-Adresse, Verweildauer des
                  Websitebesuchers auf der Website oder vom Nutzer getätigte Mausbewegungen). Die bei der Analyse
                  erfassten Daten werden an Cloudflare weitergeleitet.<br />
                  Die Speicherung und Analyse der Daten erfolgt auf Grundlage von Art. 6 Abs. 1 lit. f DSGVO. Der
                  Websitebetreiber hat ein berechtigtes Interesse daran, seine Webangebote vor missbräuchlicher
                  automatisierter Ausspähung und vor SPAM zu schützen. Sofern eine entsprechende Einwilligung abgefragt
                  wurde, erfolgt die Verarbeitung ausschließlich auf Grundlage von Art. 6 Abs. 1 lit. a DSGVO und § 25 Abs. 1
                  TDDDG, soweit die Einwilligung die Speicherung von Cookies oder den Zugriff auf Informationen im
                  Endgerät des Nutzers (z. B. Device-Fingerprinting) im Sinne des TDDDG umfasst. Die Einwilligung ist
                  jederzeit widerrufbar.<br />
                  Die Datenverarbeitung wird auf Standardvertragsklauseln gestützt, die sie hier finden:<br />
                  <a href="https://www.cloudflare.com/cloudflare-customer-scc/" target="_blank" rel="noreferrer">https://www.cloudflare.com/cloudflare-customer-scc/</a>.<br />
                  Weitere Informationen zu Cloudflare Turnstile entnehmen Sie den Datenschutzbestimmungen unter <a href="https://www.cloudflare.com/cloudflare-customer-dpa/" target="_blank" rel="noreferrer">https://www.cloudflare.com/cloudflare-customer-dpa/</a>.<br />
                  Das Unternehmen verfügt über eine Zertifizierung nach dem „EU-US Data Privacy Framework“ (DPF). Der
                  DPF ist ein Übereinkommen zwischen der Europäischen Union und den USA, der die Einhaltung
                  europäischer Datenschutzstandards bei Datenverarbeitungen in den USA gewährleisten soll. Jedes nach
                  dem DPF zertifizierte Unternehmen verpflichtet sich, diese Datenschutzstandards einzuhalten. Weitere
                  Informationen hierzu erhalten Sie vom Anbieter unter folgendem Link:<br />
                  <a href="https://www.dataprivacyframework.gov/participant/5666" target="_blank" rel="noreferrer">https://www.dataprivacyframework.gov/participant/5666</a>.
                </Typography.Paragraph>

                <Typography.Paragraph type="secondary" style={{ marginTop: '24px' }}>
                  Quelle: <a href="https://www.e-recht24.de" target="_blank" rel="noreferrer">e-recht24.de</a>
                </Typography.Paragraph>
              </Typography>
            </section>
          </div>
        </Layout.Content>

        <Layout.Footer className="hei-footer">
          <div className="hei-footer-inner">
            <div className="hei-footer-content">
              <div className="hei-footer-section hei-footer-brand">
                  <img src="/heiView_logo.png" alt="heiView" className="hei-footer-logo" />
                <ul>
                  <li className="hei-footer-copyright">
                    © {new Date().getFullYear()}
                  </li>
                </ul>
              </div>

              <div className="hei-footer-section">
                <h4>Support</h4>
                <ul>
                  <li><a href="/#faq">FAQ</a></li>
                  <li><a href="/#feedback">Feedback</a></li>
                  <li><a href="/imprint">Imprint</a></li>
                  <li><a href="/privacy">Privacy Policy</a></li>
                </ul>
              </div>

              <div className="hei-footer-section">
                <h4>Developers</h4>
                <ul>
                  <li><a href="https://github.com/heiView/heiView" target="_blank" rel="noopener noreferrer">GitHub</a></li>
                </ul>
              </div>

              <div className="hei-footer-section">
                <h4>About</h4>
                <ul>
                  <li><a href="/about">About Us</a></li>
                  <li><a href="/#joinus">Join Us</a></li>
                  <li><a href="/#contact">Contact</a></li>
                </ul>
              </div>
            </div>
          </div>
        </Layout.Footer>
      </Layout>
    </ConfigProvider>
  )
}

export default PrivacyPolicy