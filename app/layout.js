import "./globals.css";

export const metadata = {
  title: "Dixit | Play with Friends",
  description: "Create or join a private Dixit-inspired game room.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

