import type { Metadata } from 'next';
import { Archivo, Geist_Mono, Source_Serif_4 } from 'next/font/google';
import './globals.css';

const archivo = Archivo({ variable: '--font-archivo', subsets: ['latin'] });
const sourceSerif = Source_Serif_4({ variable: '--font-source-serif', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'DepSherpa — Dependency change control',
  description: 'Evidence-first dependency upgrade investigations with a human approval gate. 面向证据的依赖升级调查，并停在人工批准门。',
};

const directionContract = `<!-- impeccable-direction:4ec57010
THESIS: The active dependency change packet is the product; refuse the generic analytics dashboard.
OWN-WORLD: Carbon workbench, warm revision paper, blue-black ink, vermilion proof marks, ruled annotations, and compact editorial controls.
STORY: A maintainer submits a public repository, watches only real GitHub and npm evidence accumulate, and is told when local execution is still required.
FIRST VIEWPORT: A large revision sheet owns the center, the live evidence thread runs beside it, and Inspect repository is the only way to fill the packet.
FORM: Editorial redline and change-control ledger, grounded direction 7, seed 4ec57010. Signature interaction: the empty packet waits until public sources answer.
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
