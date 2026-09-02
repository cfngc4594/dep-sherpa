import type { Metadata } from 'next';
import { Archivo, Geist_Mono, Source_Serif_4 } from 'next/font/google';
import './globals.css';

const archivo = Archivo({ variable: '--font-archivo', subsets: ['latin'] });
const sourceSerif = Source_Serif_4({ variable: '--font-source-serif', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'DepSherpa — Dependency change control',
  description: 'Evidence-first dependency upgrade investigations with a human approval gate.',
};

const directionContract = `<!-- impeccable-direction:4ec57010
THESIS: The active dependency change packet is the product; refuse the generic analytics dashboard.
OWN-WORLD: Carbon workbench, warm revision paper, blue-black ink, vermilion proof marks, ruled annotations, and compact editorial controls.
STORY: A maintainer sees the risk, watches evidence accumulate, inspects the bounded patch, and alone decides whether it proceeds.
FIRST VIEWPORT: A large revision sheet owns the center, the live evidence thread runs beside it, and Run investigation sits at the document's signing edge.
FORM: Editorial redline and change-control ledger, grounded direction 7, seed 4ec57010. Signature interaction: the evidence thread advances into an unpressed approval stamp.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
-->`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${archivo.variable} ${sourceSerif.variable} ${geistMono.variable}`}>
        <span hidden dangerouslySetInnerHTML={{ __html: directionContract }} />
        {children}
      </body>
    </html>
  );
}
