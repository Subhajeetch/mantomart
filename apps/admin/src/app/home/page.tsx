import { redirect } from "next/navigation";

/**
 * Legacy /home route — staff land on overview after store login.
 * Auth is enforced by AdminAuthGate on the (with-sidebar) layout.
 */
export default function Home() {
  redirect("/overview");
}