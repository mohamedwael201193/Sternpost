import { Nav } from './Nav'
import { Hero } from './Hero'
import { Problem } from './Problem'
import { HowItWorks } from './HowItWorks'
import { FloorDemo } from './FloorDemo'
import { Proof } from './Proof'
import { Integrations } from './Integrations'
import { Faq } from './Faq'
import { Solution } from './Solution'
import { Routes } from './Routes'
import { Agents } from './Agents'
import { Roadmap } from './Roadmap'
import { Footer } from './Footer'

export default function Landing() {
  return (
    <>
      <Nav />
      <main>
        <Hero /><Problem /><Solution /><HowItWorks /><FloorDemo /><Routes /><Agents /><Proof /><Roadmap /><Integrations /><Faq />
      </main>
      <Footer />
    </>
  )
}
