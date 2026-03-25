import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Target, Mail } from "lucide-react"
import Link from "next/link"

export default function SignUpSuccessPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-4">
      <Card className="w-full max-w-md bg-slate-900/80 border-slate-800 text-center">
        <CardHeader className="space-y-2">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Target className="w-8 h-8 text-orange-500" />
            <span className="text-2xl font-bold text-white">ShotVision</span>
          </div>
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <Mail className="w-8 h-8 text-emerald-400" />
            </div>
          </div>
          <CardTitle className="text-2xl text-white">Check Your Email</CardTitle>
          <CardDescription className="text-slate-400">
            We sent you a confirmation link. Please check your email to verify your account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/auth/login"
            className="text-orange-400 hover:text-orange-300 font-medium text-sm"
          >
            Return to sign in
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
