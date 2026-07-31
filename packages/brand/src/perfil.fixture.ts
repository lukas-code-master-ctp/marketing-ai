/** Perfil de ejemplo usado por las pruebas y por la marcha en seco. */
export const PERFIL_VALIDO = {
  posicionamiento: {
    categoria: 'Venta de parcelas de agrado',
    promesa: 'Parcelas con factibilidad garantizada y trazabilidad legal completa',
    diferenciadores: ['Factibilidad verificada', 'Financiamiento directo'],
  },
  publicos: [
    {
      nombre: 'Inversionista primerizo',
      dolor: 'Teme comprar un terreno sin agua ni acceso legal',
      objecion: 'No sabe distinguir una parcela regularizada de una que no lo está',
    },
  ],
  tono: {
    atributos: ['claro', 'didáctico', 'sin humo'],
    hacer: ['Explicar con datos concretos', 'Reconocer los riesgos reales'],
    noHacer: ['Prometer retornos', 'Usar urgencia artificial'],
  },
  lexico: {
    preferido: ['factibilidad', 'rol', 'trazabilidad'],
    prohibido: ['Rentabilidad garantizada', 'oportunidad única'],
  },
  pilares: [
    { nombre: 'educacion', descripcion: 'Cómo evaluar una parcela', proporcion: 0.4 },
    { nombre: 'confianza', descripcion: 'Casos y respaldo legal', proporcion: 0.35 },
    { nombre: 'producto', descripcion: 'Proyectos disponibles', proporcion: 0.25 },
  ],
  ofertas: [
    {
      nombre: 'Asesoría de factibilidad',
      descripcion: 'Revisión legal previa a la compra',
      url: 'https://compratuparcela.cl/asesoria',
    },
  ],
  restricciones: {
    disclaimers: ['Las imágenes son referenciales.'],
  },
} as const
