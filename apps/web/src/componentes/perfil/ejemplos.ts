/**
 * Textos de ayuda y ejemplo de cada campo del formulario de perfil, en
 * español y como literales: `apps/web` no declara `@gc/brand` y no debe
 * declararlo, así que estos textos no salen de `PerfilDeMarca`
 * (`packages/brand/src/perfil.ts`) sino que se copian a mano.
 *
 * Los ejemplos vienen del perfil real de `parcelas` (`perfiles/parcelas.json`),
 * reescritos para que quepan en una línea junto a su campo sin perder que
 * describen la misma marca: una inmobiliaria que vende parcelas de agrado
 * con factibilidad verificada.
 *
 * Vive en su propio archivo para que ajustar un texto no obligue a tocar un
 * componente, y para leerlos todos juntos y comprobar que hablan el mismo
 * idioma.
 */
export const EJEMPLOS = {
  posicionamiento: {
    categoria: {
      ayuda: 'En qué categoría compite la marca',
      ejemplo: 'Venta de parcelas de agrado',
    },
    promesa: {
      ayuda: 'Qué promete cumplir, en una frase',
      ejemplo: 'Parcelas con factibilidad garantizada y trazabilidad legal completa',
    },
    diferenciadores: {
      ayuda: 'Qué la hace distinta de la competencia',
      ejemplo: 'Factibilidad verificada',
    },
  },
  publicos: {
    nombre: {
      ayuda: 'Cómo se llama este público',
      ejemplo: 'Inversionista primerizo',
    },
    dolor: {
      ayuda: 'Qué le preocupa antes de comprar',
      ejemplo: 'Teme comprar un terreno sin agua ni acceso legal',
    },
    objecion: {
      ayuda: 'Qué duda le impide decidirse',
      ejemplo: 'No sabe distinguir una parcela regularizada de una que no lo está',
    },
  },
  tono: {
    atributos: {
      ayuda: 'Cómo suena la marca, en pocas palabras',
      ejemplo: 'claro',
    },
    hacer: {
      ayuda: 'Qué sí hacer al escribir para esta marca',
      ejemplo: 'Explicar con datos concretos',
    },
    noHacer: {
      ayuda: 'Qué evitar al escribir para esta marca',
      ejemplo: 'Prometer retornos',
    },
  },
  lexico: {
    preferido: {
      ayuda: 'Palabras que conviene usar',
      ejemplo: 'factibilidad',
    },
    prohibido: {
      ayuda: 'Palabras o frases que no se deben usar',
      ejemplo: 'Rentabilidad garantizada',
    },
  },
  pilares: {
    nombre: {
      ayuda: 'Un nombre corto para este pilar de contenido',
      ejemplo: 'educacion',
    },
    descripcion: {
      ayuda: 'Qué tipo de contenido cubre este pilar',
      ejemplo: 'Cómo evaluar una parcela',
    },
    porcentaje: {
      ayuda: 'Qué proporción de la grilla ocupa este pilar',
      ejemplo: '40',
    },
  },
  ofertas: {
    nombre: {
      ayuda: 'Cómo se llama esta oferta',
      ejemplo: 'Asesoría de factibilidad',
    },
    descripcion: {
      ayuda: 'En qué consiste la oferta',
      ejemplo: 'Revisión legal previa a la compra',
    },
    url: {
      ayuda: 'Dónde conocer más sobre la oferta',
      ejemplo: 'https://compratuparcela.cl/asesoria',
    },
  },
  restricciones: {
    disclaimers: {
      ayuda: 'Aviso legal que debe acompañar el contenido',
      ejemplo: 'Las imágenes son referenciales.',
    },
  },
} as const
