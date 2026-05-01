# Mindrails-DPA-Vorlage zum Mitschicken

> Falls Retell, Cartesia oder ein anderer kleinerer Sub-Processor *keinen eigenen* DPA bereitstellt, schickst du diesen Standard-DPA als Markdown oder konvertiert nach PDF mit der DPA-Anfrage-Mail mit. Basis: bewährte EU-Vertragsbasis, an unsere Phonbot-Use-Cases angepasst.
>
> **So erzeugst du eine PDF-Version:**
> ```bash
> pandoc compliance/mindrails-dpa-template.md -o /tmp/Mindrails-DPA-Template-2026-04-30.pdf
> ```
> oder VS Code Print-to-PDF nutzen.

---

# DATA PROCESSING AGREEMENT

between

**Hans Ulrich Waier (Einzelunternehmer)**
Scharnhorststraße 8, 12307 Berlin, Germany
*("Controller")*

and

**[VENDOR NAME]**
*[Vendor Address]*
*("Processor")*

(each a "Party", together the "Parties")

---

## 1. Subject Matter and Duration

**1.1** This Data Processing Agreement ("**DPA**") governs the processing of personal data carried out by the Processor on behalf of the Controller in connection with the services described in the underlying main agreement (the "**Service Agreement**").

**1.2** This DPA shall enter into force upon signature by both Parties and shall remain in effect for the duration of the Service Agreement.

## 2. Nature, Purpose and Scope of the Processing

**2.1** **Nature of the Processing:** *[describe — e.g. "real-time text-to-speech conversion of text inputs supplied by the Controller through the Processor's API"]*.

**2.2** **Purpose:** Performance of the Service Agreement, specifically the operation of the Phonbot voice-agent platform by the Controller for its B2B customers.

**2.3** **Categories of Personal Data:**
- *[depending on Vendor]*: text snippets containing potentially personal data, audio fragments, telephone numbers, email addresses, transcripts of voice interactions, etc.

**2.4** **Categories of Data Subjects:** End-callers of the Controller's business customers (consumers, prospects, existing clients).

**2.5** **No Special Categories.** The Controller will not transmit special categories of personal data within the meaning of Art. 9 GDPR.

## 3. Obligations of the Processor

The Processor shall:

**3.1** Process the personal data only on documented instructions from the Controller, including with regard to transfers of personal data to a third country.

**3.2** Ensure that persons authorised to process the personal data have committed themselves to confidentiality or are under an appropriate statutory obligation of confidentiality.

**3.3** Take all measures required pursuant to Art. 32 GDPR (technical and organisational measures), including:
- Encryption of personal data in transit (TLS 1.2 or higher) and at rest (AES-256 or equivalent)
- The ability to ensure ongoing confidentiality, integrity, availability and resilience of processing systems
- The ability to restore the availability and access to personal data in a timely manner in the event of a physical or technical incident
- A process for regularly testing, assessing and evaluating the effectiveness of these measures

**3.4** Respect the conditions referred to in paragraphs 2 and 4 of Art. 28 GDPR for engaging another processor (sub-processor) — see Section 6 below.

**3.5** Taking into account the nature of the processing, assist the Controller by appropriate technical and organisational measures, insofar as this is possible, in fulfilling the Controller's obligation to respond to requests for exercising data subject rights (Art. 12-22 GDPR).

**3.6** Assist the Controller in ensuring compliance with the obligations pursuant to Art. 32 to 36 GDPR, taking into account the nature of processing and the information available to the Processor.

**3.7** **At the choice of the Controller**, delete or return all personal data to the Controller after the end of the provision of services relating to processing, and delete existing copies, unless Union or Member State law requires storage of the personal data.

**3.8** Make available to the Controller all information necessary to demonstrate compliance with the obligations laid down in Art. 28 GDPR and allow for and contribute to audits, including inspections, conducted by the Controller or another auditor mandated by the Controller.

## 4. Notification of Data Breaches

**4.1** The Processor shall notify the Controller **without undue delay, and in any event within 48 hours**, after becoming aware of a personal data breach affecting personal data processed under this DPA.

**4.2** Such notification shall, at a minimum, contain the information required by Art. 33 (3) GDPR.

## 5. Liability

The liability of the Parties shall be governed by the Service Agreement and Art. 82 GDPR.

## 6. Sub-Processors

**6.1** The Controller hereby grants the Processor general written authorisation to engage sub-processors.

**6.2** The Processor shall inform the Controller of any intended changes concerning the addition or replacement of sub-processors at least **30 days in advance**, thereby giving the Controller the opportunity to object to such changes.

**6.3** Where the Processor engages a sub-processor for carrying out specific processing activities on behalf of the Controller, the same data protection obligations as set out in this DPA shall be imposed on that sub-processor by way of a contract, in particular providing sufficient guarantees to implement appropriate technical and organisational measures.

## 7. International Transfers

**7.1** The Processor shall not transfer personal data to a country outside the European Economic Area or to an international organisation, unless required to do so by Union or Member State law to which the Processor is subject.

**7.2** Where personal data is transferred outside the EEA, the Parties shall enter into the **EU Standard Contractual Clauses (Module 3, processor-to-processor)** as approved by Commission Implementing Decision (EU) 2021/914 of 4 June 2021. The clauses shall form an integral part of this DPA.

**7.3** Where applicable, the Processor warrants its current certification under the **EU-US Data Privacy Framework** (DPF), and shall notify the Controller without undue delay of any change in certification status.

**7.4** The Processor shall conduct, and provide upon request, a Transfer Impact Assessment ("TIA") taking into account local law and practice in the third country, in line with the EDPB Recommendations 01/2020.

## 8. Audit Rights

**8.1** The Processor shall make available to the Controller all information necessary to demonstrate compliance with this DPA. Primary forms of evidence accepted by the Controller include:
- Most recent SOC 2 Type II report (or equivalent)
- ISO 27001 certificate (or equivalent)
- Penetration test summary
- The Processor's written confirmation of the Technical and Organisational Measures in Annex 1 of this DPA

**8.2** Where the foregoing is insufficient for a specific audit need, the Controller may, with at least 30 days' notice and during normal business hours, conduct an on-site audit, either by itself or through a third-party auditor bound by appropriate confidentiality obligations.

**8.3** Audits shall not exceed once per calendar year, except in the event of a documented data breach or material change in the Processor's controls.

## 9. Term and Termination

**9.1** This DPA shall remain in force for the duration of the Service Agreement.

**9.2** Upon termination, the Processor shall, at the Controller's choice, return or delete all personal data within 30 days, and confirm such return or deletion in writing.

## 10. Governing Law and Jurisdiction

**10.1** This DPA shall be governed by the laws of the Federal Republic of Germany, excluding the UN Convention on Contracts for the International Sale of Goods (CISG).

**10.2** The exclusive place of jurisdiction for any disputes arising out of or in connection with this DPA shall be Berlin, Germany, to the extent permitted by applicable law.

## 11. Final Provisions

**11.1** Should individual provisions of this DPA be or become invalid, the validity of the remaining provisions shall remain unaffected.

**11.2** Amendments and supplements to this DPA shall be made in text form.

**11.3** In the event of conflict between the Service Agreement and this DPA, this DPA shall prevail with respect to data protection obligations.

---

**Signed for and on behalf of:**

**Controller — Hans Ulrich Waier (Einzelunternehmer)**

Name: ___________________________
Title: Geschäftsführer
Date: ___________________________
Signature: _______________________

**Processor — [VENDOR NAME]**

Name: ___________________________
Title: ___________________________
Date: ___________________________
Signature: _______________________

---

## Annex 1 — Technical and Organisational Measures (TOMs) — Controller Side

The Controller's own TOMs are documented at https://phonbot.de/avv/#a1 (Annex 1 of the Mindrails AVV).

## Annex 2 — Sub-Processors used by the Controller

A current list is publicly available at https://phonbot.de/sub-processors/.
