import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
  pdf,
} from '@react-pdf/renderer';

type StoryboardFrameRecord = {
  frameNumber: number;
  description: string;
  cameraAngle: string;
  cameraMovement: string;
  durationSeconds: number;
  annotations: string[];
  imageStatus?: 'pending' | 'ready' | 'failed';
  imageUrl?: string;
};

const styles = StyleSheet.create({
  page: {
    padding: 36,
    backgroundColor: '#FDFBF5',
    fontFamily: 'Helvetica',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    paddingBottom: 12,
    borderBottom: '2px solid #1A1A1A',
  },
  headerBadge: {
    backgroundColor: '#FF9F1C',
    border: '2px solid #1A1A1A',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginRight: 10,
  },
  headerBadgeText: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: '#1A1A1A',
  },
  title: {
    fontSize: 16,
    fontFamily: 'Helvetica-Bold',
    color: '#1A1A1A',
  },
  frame: {
    marginBottom: 14,
    border: '2px solid #1A1A1A',
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#F7F4EC',
  },
  frameHeader: {
    backgroundColor: '#FF9F1C',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderBottom: '2px solid #1A1A1A',
  },
  frameHeaderText: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: '#1A1A1A',
  },
  frameBody: {
    flexDirection: 'row',
    gap: 10,
    padding: 10,
  },
  frameImage: {
    width: 150,
    height: 95,
    borderRadius: 6,
    border: '1.5px solid #1A1A1A',
    backgroundColor: '#E8E5DF',
    objectFit: 'cover',
  },
  framePlaceholder: {
    width: 150,
    height: 95,
    borderRadius: 6,
    border: '1.5px solid #1A1A1A',
    backgroundColor: '#E8E5DF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  framePlaceholderText: {
    fontSize: 7,
    color: '#999',
    fontFamily: 'Helvetica',
  },
  frameContent: {
    flex: 1,
  },
  frameDescription: {
    fontSize: 9,
    lineHeight: 1.55,
    color: '#1A1A1A',
    marginBottom: 8,
  },
  frameMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 'auto',
  },
  frameCamera: {
    fontSize: 7.5,
    color: '#666',
    fontFamily: 'Helvetica',
  },
  frameDuration: {
    fontSize: 7.5,
    fontFamily: 'Helvetica-Bold',
    color: '#FF6B6B',
  },
  annotations: {
    marginTop: 4,
  },
  annotation: {
    fontSize: 7,
    color: '#888',
    lineHeight: 1.4,
  },
});

function StoryboardPdfDocument({
  title,
  frames,
}: {
  title: string;
  frames: StoryboardFrameRecord[];
}) {
  return (
    <Document title={title} author='Leobot' creator='Leobot Storyboard'>
      <Page size='A4' style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerBadge}>
            <Text style={styles.headerBadgeText}>Storyboard</Text>
          </View>
          <Text style={styles.title}>{title || 'Untitled Storyboard'}</Text>
        </View>

        {/* Frames */}
        {frames.map((frame) => (
          <View key={frame.frameNumber} style={styles.frame} wrap={false}>
            <View style={styles.frameHeader}>
              <Text style={styles.frameHeaderText}>
                Frame {frame.frameNumber}
              </Text>
            </View>
            <View style={styles.frameBody}>
              {/* Image */}
              {frame.imageUrl ? (
                <Image
                  src={
                    frame.imageUrl.startsWith('/')
                      ? `${window.location.origin}${frame.imageUrl}`
                      : frame.imageUrl
                  }
                  style={styles.frameImage}
                />
              ) : (
                <View style={styles.framePlaceholder}>
                  <Text style={styles.framePlaceholderText}>No image</Text>
                </View>
              )}

              {/* Text content */}
              <View style={styles.frameContent}>
                <Text style={styles.frameDescription}>
                  {frame.description || 'No description.'}
                </Text>

                {frame.annotations.length > 0 ? (
                  <View style={styles.annotations}>
                    {frame.annotations.map((note, i) => (
                      <Text key={i} style={styles.annotation}>
                        • {note}
                      </Text>
                    ))}
                  </View>
                ) : null}

                <View style={styles.frameMeta}>
                  <Text style={styles.frameCamera}>
                    {frame.cameraAngle || frame.cameraMovement
                      ? `${frame.cameraAngle || 'n/a'} / ${frame.cameraMovement || 'Static'}`
                      : 'Camera in description'}
                  </Text>
                  <Text style={styles.frameDuration}>
                    Duration{' '}
                    {Number.isFinite(frame.durationSeconds)
                      ? frame.durationSeconds
                      : 3}
                    s
                  </Text>
                </View>
              </View>
            </View>
          </View>
        ))}
      </Page>
    </Document>
  );
}

export async function downloadStoryboardAsPdf(
  title: string,
  frames: StoryboardFrameRecord[],
) {
  const blob = await pdf(
    <StoryboardPdfDocument title={title} frames={frames} />,
  ).toBlob();

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${title.trim() || 'storyboard'}.pdf`;
  anchor.click();
  URL.revokeObjectURL(url);
}
