import { Metadata } from "next";
import LoginClient from "./LoginClient";

export const metadata: Metadata = {
  title: "Login/Signup - mantomart",
  description: "Login or signup to access your mantomart account",
};

export default function LoginPage() {
  return <LoginClient />;
}