// Redirect to new signup-success page
import { redirect } from 'next/navigation'

export default function SignUpSuccessPage() {
  redirect('/signup-success')
}
