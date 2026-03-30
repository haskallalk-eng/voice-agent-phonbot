export type Template = {
  id: string;
  icon: string;
  name: string;
  description: string;
  defaults: {
    name: string;
    language: 'de' | 'en';
    voice: string;
    businessDescription: string;
    servicesText: string;
    openingHours: string;
    systemPrompt: string;
    tools: string[];
  };
};

export const TEMPLATES: Template[] = [
  {
    id: 'hairdresser',
    icon: '💇',
    name: 'Friseur / Salon',
    description: 'Terminbuchungen, Öffnungszeiten, Preisauskunft',
    defaults: {
      name: 'Salon-Assistent',
      language: 'de',
      voice: 'retell-Cimo',
      businessDescription: 'Friseursalon für Damen und Herren mit Walk-in und Terminbuchung.',
      servicesText: 'Herrenschnitt, Damenschnitt, Färben, Strähnen, Waschen & Föhnen, Bartpflege',
      openingHours: 'Mo-Fr 09:00-18:00, Sa 09:00-14:00',
      systemPrompt:
        'Du bist die freundliche Telefonassistenz für einen Friseursalon. Hilf beim Buchen von Terminen, beantworte Fragen zu Services und Preisen, und nimm Rückrufwünsche entgegen. Sprich natürlich und kurz.',
      tools: ['calendar.findSlots', 'calendar.book', 'ticket.create'],
    },
  },
  {
    id: 'tradesperson',
    icon: '🔧',
    name: 'Handwerker',
    description: 'Auftragsannahme, Terminanfragen, Notdienst-Weiterleitung',
    defaults: {
      name: 'Handwerker-Assistent',
      language: 'de',
      voice: 'retell-Cimo',
      businessDescription: 'Handwerksbetrieb für Installation, Reparaturen und Wartung.',
      servicesText: 'Heizung, Sanitär, Elektro, Renovierung, Notdienst',
      openingHours: 'Mo-Fr 07:00-17:00',
      systemPrompt:
        'Du bist die telefonische Assistenz eines Handwerksbetriebs. Nimm Aufträge und Terminwünsche entgegen, frage nach Art des Problems und der Adresse. Bei Notfällen: erstelle sofort ein Ticket mit hoher Priorität. Sprich kurz und klar.',
      tools: ['calendar.findSlots', 'calendar.book', 'ticket.create'],
    },
  },
  {
    id: 'medical',
    icon: '🏥',
    name: 'Arztpraxis / Praxis',
    description: 'Terminvereinbarung, Sprechzeiten, Rezeptbestellung',
    defaults: {
      name: 'Praxis-Assistent',
      language: 'de',
      voice: 'retell-Cimo',
      businessDescription: 'Arztpraxis für Allgemeinmedizin.',
      servicesText: 'Vorsorge, Impfungen, Blutabnahme, Rezepte, Überweisungen, Akutsprechstunde',
      openingHours: 'Mo-Fr 08:00-12:00, Mo Di Do 14:00-17:00',
      systemPrompt:
        'Du bist die telefonische Assistenz einer Arztpraxis. Hilf bei Terminvereinbarungen, informiere über Sprechzeiten und nimm Rückrufwünsche entgegen. Gib KEINE medizinischen Ratschläge. Bei Notfällen verweise auf 112. Sprich freundlich und professionell.',
      tools: ['calendar.findSlots', 'calendar.book', 'ticket.create'],
    },
  },
  {
    id: 'cleaning',
    icon: '🧹',
    name: 'Reinigungsfirma',
    description: 'Angebote, Terminplanung, Sonderwünsche',
    defaults: {
      name: 'Reinigungs-Assistent',
      language: 'de',
      voice: 'retell-Cimo',
      businessDescription: 'Professionelle Gebäudereinigung und Haushaltsreinigung.',
      servicesText: 'Unterhaltsreinigung, Grundreinigung, Fensterreinigung, Büroreinigung, Umzugsreinigung',
      openingHours: 'Mo-Fr 08:00-18:00',
      systemPrompt:
        'Du bist die telefonische Assistenz einer Reinigungsfirma. Frage nach Art der Reinigung, Fläche/Räume und gewünschtem Termin. Erstelle ein Ticket für individuelle Angebote. Sprich freundlich und direkt.',
      tools: ['calendar.findSlots', 'ticket.create'],
    },
  },
  {
    id: 'custom',
    icon: '⚙️',
    name: 'Eigener Agent',
    description: 'Komplett selbst konfigurieren',
    defaults: {
      name: 'Mein Agent',
      language: 'de',
      voice: 'retell-Cimo',
      businessDescription: '',
      servicesText: '',
      openingHours: 'Mo-Fr 09:00-17:00',
      systemPrompt:
        'Du bist eine freundliche telefonische Assistenz. Hilf Anrufern mit ihren Anliegen, beantworte Fragen und nimm Rückrufwünsche entgegen. Sprich kurz und natürlich.',
      tools: ['calendar.findSlots', 'calendar.book', 'ticket.create'],
    },
  },
];
