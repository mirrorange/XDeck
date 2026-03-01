import { useEffect } from "react";
import { useNavigate } from "react-router";

export function meta() {
  return [
    { title: "XDeck" },
    { name: "description", content: "XDeck - Lightweight Service Management Panel" },
  ];
}

export default function Home() {
  const navigate = useNavigate();

  useEffect(() => {
    navigate("/dashboard", { replace: true });
  }, [navigate]);

  return null;
}
