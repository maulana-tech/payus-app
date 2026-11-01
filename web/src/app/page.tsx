import { Chrome } from "../components/landing/Chrome";
import { Footer } from "../components/landing/Footer";
import { Hero } from "../components/landing/Hero";

export default function Home() {
  return (
    <Chrome>
      <main id="main-content" className="overflow-x-clip">
        <Hero />
      </main>
      <Footer />
    </Chrome>
  );
}
