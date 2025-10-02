import "./global.css";

export const metadata = {
  title: "Best Bet NFL",
  description: "Actual probabilities for NFL bets",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

