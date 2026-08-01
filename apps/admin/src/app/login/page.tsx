import { Metadata } from "next";
import LoginClient from "./LoginClient";

export const metadata: Metadata = {
  title: "Login/Signup - Mantomart",
  description: "Login or signup to access your Mantomart account",
};

export default function LoginPage() {
  return <LoginClient />;
}