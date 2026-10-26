package io.github.nandrianina02.unichat;

import android.content.Intent;
import android.os.Process;

import java.io.PrintWriter;
import java.io.StringWriter;

/**
 * Un plantage au lancement ne laisse rien voir sans débogage USB : la cause
 * est montrée par l'écran Diagnostic (processus à part), pour qu'on puisse
 * la copier et la corriger.
 */
public class Application extends android.app.Application {
    @Override
    public void onCreate() {
        super.onCreate();
        final Thread.UncaughtExceptionHandler precedent = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((fil, erreur) -> {
            try {
                StringWriter trace = new StringWriter();
                erreur.printStackTrace(new PrintWriter(trace));
                Intent diagnostic = new Intent(this, DiagnosticActivity.class)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK)
                        .putExtra(DiagnosticActivity.TRACE, "UniChat " + BuildConfig.VERSION_NAME + " (" + BuildConfig.VERSION_CODE + "), Android "
                                + android.os.Build.VERSION.RELEASE + ", " + android.os.Build.MODEL + "\n\n" + trace);
                startActivity(diagnostic);
            } catch (Throwable ignore) {
                if (precedent != null) precedent.uncaughtException(fil, erreur);
            }
            Process.killProcess(Process.myPid());
            System.exit(10);
        });
    }
}
