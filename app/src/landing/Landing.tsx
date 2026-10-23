import { Nav } from './Nav'
import { Hero } from './Hero'
import { Problem } from './Problem'
import { HowItWorks } from './HowItWorks'
import { FloorDemo } from './FloorDemo'
import { Proof } from './Proof'
import { Integrations } from './Integrations'
import { Faq } from './Faq'
import { Footer } from './Footer'

export default function Landing() {
  return (
    <>
      <Nav />
      <main>
        <Hero /><Problem /><HowItWorks /><FloorDemo /><Proof /><Integrations /><Faq />
      </main>
      <Footer />
    </>
  )
}
