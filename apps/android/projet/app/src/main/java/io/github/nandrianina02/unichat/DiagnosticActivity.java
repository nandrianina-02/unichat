package io.github.nandrianina02.unichat;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.os.Bundle;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

/** L'erreur qui a arrêté l'appli, à copier ou partager. */
public class DiagnosticActivity extends Activity {
    static final String TRACE = "trace";

    @Override
    protected void onCreate(Bundle etat) {
        super.onCreate(etat);
        final String trace = getIntent().getStringExtra(TRACE) != null ? getIntent().getStringExtra(TRACE) : "Aucune erreur enregistrée.";
        LinearLayout colonne = new LinearLayout(this);
        colonne.setOrientation(LinearLayout.VERTICAL);
        int marge = (int) (16 * getResources().getDisplayMetrics().density);
        colonne.setPadding(marge, marge * 2, marge, marge);
        TextView titre = new TextView(this);
        titre.setText("UniChat s'est arrêté. Copie ce texte et envoie-le pour qu'on corrige.");
        titre.setTextSize(16);
        colonne.addView(titre);
        Button copier = new Button(this);
        copier.setText("Copier");
        copier.setOnClickListener(v -> {
            ((ClipboardManager) getSystemService(CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("UniChat", trace));
            Toast.makeText(this, "Copié", Toast.LENGTH_SHORT).show();
        });
        colonne.addView(copier);
        Button partager = new Button(this);
        partager.setText("Partager");
        partager.setOnClickListener(v -> startActivity(Intent.createChooser(new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, trace), "Partager")));
        colonne.addView(partager);
        TextView texte = new TextView(this);
        texte.setText(trace);
        texte.setTextIsSelectable(true);
        texte.setTextSize(12);
        ScrollView defilement = new ScrollView(this);
        defilement.addView(texte);
        colonne.addView(defilement);
        setContentView(colonne);
    }
}
