// Redirect to new auth-error page
import { redirect } from 'next/navigation'

export default function AuthErrorPage() {
  redirect('/auth-error')
}
