"""Export all pages for QA independently of a document's saved n-up setting."""


def export_pdf(hwp, destination):
    # Hancom's SaveAs(PDF) can inherit PrintMethod=4 and combine two pages.
    # Explicitly name the virtual PDF printer and output file; never use a
    # user's default physical printer. Callers do not save the changed print
    # settings back to either official originals or public conversion assets.
    action = hwp.CreateAction('PrintToPDFEx')
    settings = action.CreateSet()
    action.GetDefault(settings)
    for key, value in {
        'FileName': str(destination), 'PrinterName': 'Hancom PDF',
        'PrintMethod': 0, 'Range': 6, 'NumCopy': 1, 'Collate': 1,
        'UsingPagenum': 0, 'ReverseOrder': 0, 'Pause': 0,
        'PrintImage': 1, 'PrintDrawObj': 1,
    }.items():
        settings.SetItem(key, value)
    if not action.Execute(settings):
        raise RuntimeError('Controlled all-page PDF export failed')
