from django.db import migrations, models


def lower_existing_notice(apps, schema_editor):
    """Coaches still on the old 24-hour default move to 12.

    A coach who deliberately chose some other number keeps it; 24 was only ever
    the default nobody had touched, and it cost a real booking — a slot 21 hours
    away that an invited client could not accept.
    """
    UserProfile = apps.get_model('profiles', 'UserProfile')
    UserProfile.objects.filter(role='coach', min_notice_hours=24).update(min_notice_hours=12)


class Migration(migrations.Migration):

    dependencies = [
        ('profiles', '0008_userprofile_resources_seen_at'),
    ]

    operations = [
        migrations.RunPython(lower_existing_notice, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='userprofile',
            name='min_notice_hours',
            field=models.PositiveIntegerField(
                default=12,
                help_text='Minimum lead time, in hours, required before a session can start.',
            ),
        ),
    ]
