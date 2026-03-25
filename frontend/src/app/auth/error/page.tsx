import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Target, AlertCircle } from "lucide-react"
import Link from "next/link"

export default function AuthErrorPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-4">
      <Card className="w-full max-w-md bg-slate-900/80 border-slate-800 text-center">
        <CardHeader className="space-y-2">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Target className="w-8 h-8 text-orange-500" />
            <span className="text-2xl font-bold text-white">ShotTracker</span>
          </div>
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center">
              <AlertCircle className="w-8 h-8 text-red-400" />
            </div>
          </div>
          <CardTitle className="text-2xl text-white">Authentication Error</CardTitle>
          <CardDescription className="text-slate-400">
            Something went wrong during authentication. Please try again.
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
